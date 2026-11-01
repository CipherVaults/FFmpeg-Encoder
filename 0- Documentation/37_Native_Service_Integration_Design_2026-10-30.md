# Native file runtime: integration into the application service

**Status:** design proposal for the root writer. Drafted October 30 2026 and revised the same day after two review passes (findings A1–A11 and B1–B12; see "Review disposition" at the end). Nothing has been implemented. This document grants no permission, observes no hardware and accepts nothing.
**Scope:** milestone P software item B-NATIVE-FILE-SW, obligation 7 ("normal service lifecycle"), from `native-runtime-next-contract-review.md:62-70`. It also covers the readiness and refusal rules that P01–P03 need. Obligation 7 needs no renderer channel or UI, so this revision defers C5–C6 to the owner (§12).
**Baseline:** HEAD `9a2d27e` on `codex/v0.7-candidate`. Nothing under `src/`, `tests/`, `ui/`, `main.js` or `preload.js` has changed since `a5fc3e8`. The unwired runtime was committed at `253c567`.
**Owner gates left untouched:**
- the AMF producer technical disposition;
- milestone and product acceptance;
- any production native file policy or reference row;
- the scope decision on C5–C6 (a renderer channel and UI for a path no production build can reach).

**Observations made while designing and reviewing (read-only):**
- The unwired runtime is `src/native-file-runtime.cjs` (223 lines). Nothing outside `tests/native-file-runtime.test.cjs` imports it.
- `EncoderService.acquireNativeMediaSlot` (`src/encoder-service.cjs:360-367`) accepts only phase `native-checking` and the purposes `native-backend-initialization` / `native-backend-capability`. The runtime asks for `native-file-runtime` (`native-file-runtime.cjs:106`).
- `publish` runs `#destination` (`native-file-runtime.cjs:188`) before the full source re-hash in `assessCompleted` (`native-file-source.cjs:142`), and links only after that (`:192`). The ordinary job does it the other way round: it assesses the source first and publishes right after `verifyFolders` (`encoder-service.cjs:1663-1672`).
- Error messages can carry paths:
  - `assertOrdinaryPath` (`candidate-runtime.cjs:131-134`) puts full paths in its `ERR_ASSERTION` messages, and `#rootCurrent` calls it unwrapped.
  - `publishOutput` (`outputs.cjs:296-299, 330-334`) rethrows link and copy errno errors, paths included.
  - The ordinary job copies `error.message` into `item.reason` and `state.error` (`encoder-service.cjs:1706, 1716`).
- `encoder:diagnostic-record` calls `DiagnosticJournal.read`, which returns the whole event, stderr text included (`diagnostics.cjs:509-528`). `readSession` (`:531`) does the same but has no IPC channel today.
- `getEncodingDetails` returns `entry.actualArgs`, the ffmpeg path and the destination (`encoder-service.cjs:552-553`).
- When `getCapabilities` is not cached, it runs `discoverBackends`, which calls `nativeBackends.refresh`, which calls `#drop()` (`native-backend-controls.cjs:60-63`, `native-backend-service.cjs:100-106`). `observeFileSelection` also calls `#drop()` on any error, cancellation included (`:231`).
- `registerFolder` stores `fs.realpath` results (`encoder-service.cjs:436`), so a mapped network drive arrives as a UNC path.
- `cleanupStage` keeps an unsealed stage after a cancelled encode (`outputs.cjs:245`). For a native job that stage lives under `stateDir`, not in the output folder.
- Two seal checks were run against the working tree, and both return **false**:
  - the HDR producer seal, `verifyHdrCatalogSeals(PRODUCERS)` (`hdr-catalog.cjs:15`);
  - the Encode-preservation producer seal, `verifySourceCatalogSeals` over its 32 paths.

  Both catalogs pin `main.js`, `preload.js`, `src/ipc.cjs` and `src/encoder-service.cjs`, so this integration does not newly expire an active seal. Re-activating either catalog still needs its own owner-approved reseal, and the HDR reseal is out of scope under record 35.

---

## 1. Invariants (all must hold after every commit)

1. **P04 ordinary path unchanged.** These stay byte-for-byte: CPU/NVIDIA prepared argv, `PROFILES`, defaults, Archive CQ29 (`media.cjs:69`), the benchmark configuration and accepted tags. No ordinary branch consumes native state.
2. **Production native file policies stay `[]`.**
   - Main composes only `DEFAULT_NATIVE_FILE_POLICIES`, and the production factory has no `policies` or `run` parameter.
   - Main asserts at startup that the composed controls carry the production brand and `policyCount === 0`.
   - There is no IPC, preference, file or environment path to policy rows.

   With `[]`, every native batch is refused before any capability check, folder scan, inspection, lease, hash or child process.
3. **Beta never enables Start.** Start is reachable only through items with status `ready`. A native item becomes `ready` only when a validated policy row that has a reference admits it. The Beta labels "AMD AMF — Beta" and "Intel Quick Sync — Beta" stay visible.
4. **No fallback.** There is no backend, RC, CPU or NVIDIA substitution and no silent option stripping. A refused native file stays refused with its specific code.
5. **One owner per job.** Each native job creates one fresh, single-use `NativeFileRuntimeOwner` and closes it in that job's `finally`.
   - A close that rejects, or that resolves while the owner still holds anything, quarantines the owner, the slot and admission (§4).
   - The renderer sees the honest code `NATIVE_OWNER_UNSETTLED`.
6. **Main owns all authority:** selection tokens, contracts, policy rows, source and stage paths, argv and the runtime.
   - C1–C4 add no renderer channel.
   - Once C5 is approved, the renderer sends only folder IDs plus `{selectionId, revision}` and receives only typed status records.
7. **Publication goes only through `runtime.publish(token, checkedReceipt, {destination, signal, requireDestinationCurrent})`.**
   - Main computes the destination as `plan.output` joined with the derived `outputName`.
   - Main rechecks the output folder and the reserved paths before the call, and again inside `requireDestinationCurrent`. The runtime runs that callback, then re-runs `#destination`, immediately before the link.
8. **Cancellation, renderer loss and shutdown use the existing paths:** `cancelCurrent`, `render-process-gone`, the window-close prompt and `closeOperationResources`. There is no native-only cancel path.
9. **Fixed text only.** Every native refusal that reaches the renderer takes its message from one frozen main table (§6). That covers `item.reason`, `state.error`, an IPC envelope and any journal field the renderer can read. Paths, errno text, argv, policy and evidence IDs, and stderr stay main-only.

---

## 2. Components and ownership

```
Trust boundary: Electron main process
  main.js (fixed composition)
    verifyCandidateRuntime ─► createNativeBackendControls ─► nativeBackends (selection)
                           └► createNativeFileControls({runtime, stateDir, nativeBackends})
                                ─► nativeFiles (catalog [], readiness/assess/createJob,
                                   stateDir stamp, kept-stage bound); startup brand assertion
  EncoderService (one scheduler / controller / taskPromise)
    prepareNativeFileBatch ─► plan{operation:'native-encode', entries(native:true)}
    startBatch ─► execute ─► executeNativeJob ─► NativeFileRuntimeOwner (one per job)
         nativeMediaSlot ◄─ acquireNativeFileSlot(jobOwner) ◄─ lease adapter
    publish only via runtime.publish(..., requireDestinationCurrent) ─► <output>\<name>_h264-qsv.mkv
  Main-private: plan.entries, nativeFileJob, nativeFileRuntime, journal context.nativePrivate
      │ existing typed IPC only (C1–C4)  │ argv arrays, no shell        │ fs (lstat/hash/link/copy EXCL)
      ▼                                  ▼                              ▼
  Sandboxed renderer (untrusted)     ffmpeg/ffprobe, DXGI helper,     source folder, output folder,
                                     vendor driver (untrusted output) stateDir\native-files (owned root)
```

### New modules (CommonJS, main-only)

| Module | Role | Authority |
|---|---|---|
| `src/native-file-controls.cjs` | **Production factory:** `createNativeFileControls({runtime, stateDir, nativeBackends})`. It requires exactly these own data keys; any other key, including `policies` or `run`, fails with `INVALID_NATIVE_FILE_COMPOSITION`. The catalog is always `DEFAULT_NATIVE_FILE_POLICIES` and there is no runner.<br>**Test factory:** `createTestNativeFileControls({runtime, stateDir, nativeBackends, policies, run})`.<br>**Brand:** `nativeFileControlsKind(value)` returns `'production'`, `'injected'` or `null`, from a module-private WeakMap.<br>**The frozen object:** `policyCount`, `readiness(view)`, `assess({contract, selection})`, `createJob({acquireMediaSlot})` and `keptStages()`.<br>**Messages:** the frozen `NATIVE_MESSAGES` table and `nativeRefusal(error)` (§6). | Construction writes nothing and starts no process. It records `stateDir`'s `{dev, ino, birthtimeNs}` with `lstatSync` and requires `realpathSync.native(stateDir)` to equal `path.resolve(stateDir)`; `main.js:137` has already created the directory. The lease adapter (§5, step 4) runs only after a slot is held, mirroring `native-backend-controls.cjs:28-41`. Any failure in it releases the slot. |
| `src/native-file-workspace.cjs` | Service helpers called with `.call(this, …)`, following the remux, HDR and preservation workspace pattern:<br>• `prepareNativeItem`<br>• `executeNativeJob`<br>• `nativeGenerationDescription`<br>• `nativeDetails`<br>• `nativeDisposition` | Runs only inside an existing `EncoderService` phase (`preparing` / `running`). |

### Changed modules

**`src/native-file-runtime.cjs`** gets four changes:
- **R1. Pure admission check.** The policy-matching block (`:96-103`) moves into a module-private ordered reason function. A new export, `assessNativeFileAdmission({policies, runtime, contract, selection})`, returns `{schema:1, admissible, reasonCodes[], policyId|null, referencePresent, executionAuthority:'none'}`.
  - It does no I/O, takes no lease and mutates no owner.
  - `prepare` keeps throwing the same first code, in the same order: empty catalog, marker, AMF, `requireFileSelection`, pins, request, unique match.
- **R2. Published identity.** The `publish` success receipt adds `identity`. This is the value `readPublishedOutputIdentity(e.stage)` already computes at `:194` and currently discards. The identity stays in main.
- **R3. Destination currentness and publication facts.**
  - `publish` requires a `requireDestinationCurrent` function. After `requirePublicationCurrent` and the second `#selectionCurrent`, it awaits that callback. It then re-runs `#destination`, which must return the same canonical string as the first call, sets `publication = 'attempted'`, and calls `publishOutput`.
  - The snapshot gains `publication`, one of:
    - `not-attempted`
    - `attempted`
    - `committed` (`publishOutput` returned true)
    - `collision`
    - `verified` (the full-SHA readback matched)
  - The snapshot also gains `stageState`: `none`, `unsealed`, `sealed` (set after `sealStage`) or `validated` (set after `markStageValidated`).
- **R4. Earlier root stamp.** `prepare` calls `#rootCurrent(e)` immediately after the slot is held and before `#source.seal`. The root stamp is then taken next to the lease adapter's check, instead of after full source and pair hashing (`:113`).

All 27 existing runtime tests run **unedited**. If one fails only because it depends on the old order, the root writer stops and reports it instead of editing the test. New tests cover R1–R4 (C1).

**Other changed files:**
- **`src/encoder-service.cjs`:** seams only; no ordinary statement is rewritten. The exact list is in §9.
- **`src/diagnostics.cjs`:** `read` and `readSession` return events through a module-private `rendererEvent()`.
  - It applies to events whose `context` holds the reserved key `nativePrivate`. In those events `nativePrivate` becomes `'[main-only]'` and `stderr` becomes `{withheld:true, bytes}`.
  - The persisted file does not change; it is the durable audit record for R1 in §10.
  - `buildRedactedExport` already drops unknown groups and stderr. NS-09 proves this for native events.
- **`main.js`:** one composition call, one constructor option, and the startup brand assertion from invariant 2. If the assertion fails, startup fails closed.
- **Deferred (§12, owner scope gate):** `src/ipc.cjs`, `preload.js`, `ui/index.html` and `ui/renderer.js`.

---

## 3. Admission

### 3.1 Readiness projection (pure)
`nativeFiles.readiness(view)` is computed from three inputs:
- the native snapshot (`native-backend-service.cjs:61-75`), including the registry's per-profile `reason`;
- the composed runtime pins;
- the catalog.

Reasons are evaluated in a **fixed order**. A reason is shown unless a reason it depends on is already present; this is the "Hides" column. `NATIVE_FILE_POLICY_REQUIRED` is never hidden.

| # | Code | Condition | Hides | User text (frozen main table) |
|---|---|---|---|---|
| 1 | `NATIVE_FILE_RUNTIME_UNAVAILABLE` | `nativeFiles` or `nativeBackends` is not composed | all others | Native file encoding is not available in this build. |
| 2 | `NATIVE_DISCOVERY_UNOBSERVED` | Every native profile reason is `DISCOVERY_NOT_OBSERVED` or `DEVICE_DISCOVERY_INCOMPLETE`: discovery never ran, failed or is incomplete | 3, 4, 7 | Native devices have not been checked on this computer yet, or the last check did not finish. |
| 3 | `NATIVE_HARDWARE_UNAVAILABLE` | Discovery is complete and the selected backend, or both backends when nothing is selected, report `MISSING_DEVICE` | 4, 7 | No Intel Quick Sync or AMD AMF device was found on this computer. |
| 4 | `NATIVE_SELECTION_REQUIRED` | Devices exist but there is no current selection | 7 | Choose a native device and exact settings, then run "Check these settings". |
| 5 | `AMF_EFFECTIVE_PROPERTIES_UNOBSERVED` | The selection's backend is `amf` | 7 | AMD AMF cannot encode files yet. The pinned FFmpeg cannot report the settings AMF actually used. This is a missing producer, not missing hardware. |
| 6 | `NATIVE_FILE_REQUEST_UNSUPPORTED` | The profile is not `h264-qsv`/`h264-amf`, or the bit depth is not 8 | 7 | Native file encoding (Beta) supports only H.264 8-bit SDR to Matroska. |
| 7 | `NATIVE_CAPABILITY_UNVERIFIED` | `selection.probeVerified !== true` | — | These exact settings have not passed the generated-sample check in this session. |
| 8 | `NATIVE_FILE_POLICY_REQUIRED` | The catalog is empty, or no row matches this runtime identity, cell key, profile and settings | — | No qualified native file policy exists for this device, runtime and settings, so file encoding stays off. |
| 9 | `NATIVE_FILE_REFERENCE_REQUIRED` | Matching rows exist but none has a `reference` | — | The matching policy has no qualified reference output, so a result could never be validated or saved. |

The projection is `{schema:1, beta:true, available: reasons.length===0, reasons:[{code,message}], policyCount, keptStages}`. Under production `[]`, `available` is always false. Main uses it for the §3.2 gate and for Start. Showing it in the renderer is part of the deferred C6.

Expected reasons on this machine, which has no AMD or Intel device:
- before the first capability check: `NATIVE_DISCOVERY_UNOBSERVED`, `NATIVE_FILE_POLICY_REQUIRED`;
- after it: `NATIVE_HARDWARE_UNAVAILABLE`, `NATIVE_FILE_POLICY_REQUIRED`.

### 3.2 `prepareNativeFileBatch(request)`: the gate, in order
Every refusal goes through `nativeRefusal` (§6).

1. **Request shape.** The request must be a plain object, with prototype `Object.prototype` or `null`. It must have exactly four own, enumerable **data** properties: `inputFolderId`, `outputFolderId`, `selectionId` and `revision`.
   - The three IDs must pass `id()`. `revision` must be a safe integer of 0 or more.
   - Refusal codes: `INVALID_REQUEST`, `INVALID_ID`, `INVALID_NATIVE_REQUEST`.
2. **Host and idle.** `nativeFileControlsKind(this.nativeFiles)` must be non-null and `this.nativeBackends` must be present; otherwise `NATIVE_FILE_RUNTIME_UNAVAILABLE`. Then `requireIdle()` (§4).
3. **Folders (lexical, synchronous).** The roles must be correct (`INVALID_FOLDER`).
   - Same folder for input and output: `NATIVE_FILE_SAME_FOLDER_UNSUPPORTED`.
   - Input: must be drive-qualified (`/^[A-Za-z]:\\/`), otherwise `NATIVE_FILE_SOURCE_PATH_UNSUPPORTED`.
   - Output: `output.path` and every derived `outputName` must pass the runtime's `#destination` rules (`native-file-runtime.cjs:176-178`), otherwise `NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED`. The path must be:
     - drive-qualified, so UNC paths and mapped network drives (which `registerFolder` resolves to UNC) are refused;
     - free of any further `:`;
     - not equal to or inside `stateDir\native-files` (compared case-insensitively).

     The name must end in `.mkv`, must not be a reserved device name, must not end in a dot or space, and must not contain a forbidden character.
4. **Readiness.** If `readiness(view)` is unavailable, throw `reasons[0].code`, with a message that joins every reason text in order. The thrown code is always the first shown reason, and the tests assert exactly that (B9).
5. **Capabilities, before the token.** `await this.getCapabilities()`. Then re-run `requireIdle`, the folder-registration lookups and step 4.
6. **Selection capture.** `token = nativeBackends.captureFileSelection({selectionId, revision})`. It runs synchronously after step 5, with no `await` between it and step 7.
   - If step 5 ran an uncached check, its refresh has already dropped the selection. The capture then throws `STALE_NATIVE_SELECTION` with this text: 'The capability check re-ran native discovery, so the earlier settings check no longer applies. Run "Check these settings" again.'
   - Other refusals: `NATIVE_CAPABILITY_UNVERIFIED`, `AMF_EFFECTIVE_PROPERTIES_UNOBSERVED`, `NATIVE_BACKEND_BUSY`, `NATIVE_OWNER_UNSETTLED`. The token never leaves main.
7. **Begin.** Call `begin('preparing')` with:
   - `state.operation = 'native-encode'` and `state.settings = null`;
   - `state.native = {beta:true, profileId, label, settings: token.request.settings}`;
   - `plan = {operation:'native-encode', draft:null, nativeSelection: token, …}`.

   Then run the shared `captureFolders`, `verifyFolders`, baseline and inspection workers. After `verifyFolders`, `assertOrdinaryPath(plan.output, 'directory')` refuses a reparse ancestor with `NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED`. `outputName = encodeOutputName(name, profileId)`.
8. **Before `state.phase = 'ready'`.** Call `nativeBackends.requireFileSelection(token)`. On failure the preparation fails with `NATIVE_FILE_SELECTION_STALE` and `plan = null`.

**Why the empty catalog stops at step 4.** With `[]`, step 4 always fails, because `NATIVE_FILE_POLICY_REQUIRED` is always present. This happens before the capability await, so no capability check runs, no folder is read, nothing is inspected and the phase never changes.

### 3.3 Per-file preparation: `prepareNativeItem` (only with a non-empty catalog, which today means injected tests)
The shared `prepareItem` runs unchanged up to `item.summary = inspection.summary;` (`encoder-service.cjs:787`). One added line follows it:
`if (this.plan.operation === 'native-encode') return prepareNativeItem.call(this, item, { file, destination, inspection, identity, marker, signal });`

The shared catch at `:867-875` copies `error.message` and stderr into the item. So `prepareNativeItem` catches its own errors and sets the item through `nativeRefusal` (§6). It rethrows only `CANCELLED` and `sharedFailure` errors, and those carry table text.

Generated sources end as `generated`, suspicious ones as `provenance-issue` and legacy-named ones as `ambiguous`. Native plans grant no overrides and no re-encode authorizations (§3.5).

`prepareNativeItem`:
1. **Request.** Built in main only: `{schema:1, kind:'native-file', operation:'encode', fileId:item.id, identityRevision:0, draftId:plan.id, draftRevision:0, profileId, settings:token.request.settings, bitDepth:8, target:'matroska', resolution:'source', range:null, signal:'sdr', hdrPolicy:'sdr', audioPolicy:'copy', omissionRequestIds:[]}`.
2. **Source description.** `applicability = describeNativeFileSource({probe: inspection.probe, sourceBytes: String(identity.size), request})`. If the status is `outside-contract`:
   - the item gets `status:'unsupported'` and `reasonCode` set to the first code;
   - `nativeReasons` holds at most 16 codes.
3. **Contract.** `contract = buildNativeFileContract({request, applicability})`, held only in `plan.entries`.
4. **Policy assessment.** `nativeFiles.assess({contract, selection: token})`. If it is not admissible: `unsupported`, `reasonCode = reasonCodes[0]` and `nativeReasons = reasonCodes`. This includes `NATIVE_FILE_REFERENCE_REQUIRED`.
5. **Output identity.** `outputId = createOutputId()`. `generationDescription = nativeGenerationDescription(contract.encoderContribution, {appVersion, createdAt, runtimeVersion})`. It must pass `generationDescriptionOf`; otherwise `NATIVE_FILE_DESCRIPTION_MISMATCH`.
6. **Store the entry.** `plan.entries.set(item.id, {native:true, file, destination, fingerprint:identity, inspection, outputId, generationDescription, contract, selection:token, policyId, details: Object.freeze(nativeDetails(contract))})`.
   - `details` is computed once, here. Nothing ever derives it from `entry.contract` later.
   - The item gets `status:'ready'`, `beta:true` and a fixed Beta reason.

Plan-time matching uses `sourceProbeFingerprint`. The full source SHA-256 is checked by `runtime.prepare` (`native-file-runtime.cjs:108-109`); a mismatch fails that job with `NATIVE_FILE_SOURCE_UNQUALIFIED`.

### 3.4 Start
`requireNativeStart(selected)` goes in `startBatch` at one exact place: after the selection-validation loop (`encoder-service.cjs:1351-1358`), which only throws, and before the status loop at `:1359`. No item, draft or phase has changed at that point. It is synchronous and checks:
- the `nativeFiles` brand;
- `readiness(view).available`;
- for each selected entry, `nativeBackends.requireFileSelection(entry.selection)` (`NATIVE_FILE_SELECTION_STALE`, `NATIVE_BACKEND_BUSY`);
- that `nativeFiles.assess(...)` is still admissible.

A refused Start therefore leaves every item `ready`, the phase `ready` and the plan startable. This refreshes `requireVerified` at Start, as `native-file-dependency-disposition.md:54` requires.

### 3.5 Guards while a native plan is ready
- **Selection changes.** `selectNativeBackend`, `refreshNativeBackends` and `qualifyNativeBackend` throw `NATIVE_FILE_PLAN_ACTIVE`.
- **Source permissions.** `treatAsOriginal` and `reencodeOutputs` throw `NATIVE_FILE_SOURCE_PERMISSION_REQUIRED`.
- **Option edits.** `requireEditableDraft` (`:1031`) throws `NATIVE_FILE_OPTIONS_FIXED`.
- **Ordinary settings.** `invalidatePreparedEncoding` (`:462`) returns early for native plans. `invalidatePlan` still drops them.
- **Cancel.** `cancelCurrent` (`:1805`), in its ready branch, revokes a native plan:
  - it clears the entries, drops the tokens and contracts, and sets `plan = null`;
  - it marks the items cancelled and records `PREPARED_NATIVE_CANCELLED`.

---

## 4. Lease, queue and quarantine

`acquireNativeFileSlot(jobOwner, {signal, purpose})` is not in the IPC table. It refuses with `NATIVE_MEDIA_ADMISSION_REFUSED` unless **all** of these hold:
- `!this.admissionClosed`;
- phase `running`;
- `this.nativeFileJob === jobOwner`;
- `purpose === 'native-file-runtime'`;
- neither the signal nor `this.controller.signal` is aborted;
- `!this.nativeMediaSlot`.

On success it sets `this.nativeMediaSlot = slotOwner` and returns `{release}`. Release runs at most once and clears the slot only if the slot still holds `slotOwner`. `acquireNativeMediaSlot` stays byte-identical.

**Quarantine.**
- `requireIdle` gains one line after the `SHUTTING_DOWN` check: `if (this.nativeFileRuntime && !this.busy) { this.settleNativeFileRuntime(); throw NATIVE_OWNER_UNSETTLED }`. The settle call is not awaited. The text is: "A native file job has not confirmed that it released its device, files and work folder. The app is retrying; try again. If this continues, restart the app."
- While a native job is running, `busy` is true and the existing `BUSY` applies. Ordinary CPU/NVIDIA work therefore gets an honest code, not a generic BUSY that lasts until restart.

`settleNativeFileRuntime()` is single-flight, through `this.nativeSettle`:
1. `await runtime.close()`.
2. Require `busy`, `leaseHeld`, `leaseOwnershipUnknown` and `sourceHeld` in the snapshot to be false, and `this.nativeMediaSlot === null`.
3. Only then null `nativeFileRuntime` and `nativeFileJob`, record `NATIVE_RUNTIME_SETTLED` and call `emitState()`.

If `close()` rejects for any reason, or any of those checks fails, both fields stay and `NATIVE_RUNTIME_CLOSE_FAILED` is recorded. The runtime decides whether a retry is possible: transient failures reset its `#closing`, while unknown child, lease or source ownership never does (`native-file-runtime.cjs:221`). That case stays quarantined until restart. `closeOperationResources` awaits the same function before `nativeBackends.invalidate()`.

**Queue.** Native jobs run inside the existing `execute(selected, signal)` loop, under the same controller and `taskPromise`. One block is added at `:1375`, after `const entry = this.plan.entries.get(item.id);`:
```js
if (entry.native) {
  const outcome = await executeNativeJob.call(this, item, entry, signal); // never throws (§6)
  if (outcome === 'stop') { stoppedByFailure = true; break; }
  if (outcome === 'cancelled') break;
  continue;
}
```
The outer `finally` drops native authority by setting `entry.selection = null` and `entry.contract = null`, and keeps the frozen `entry.details`.

---

## 5. Job sequence (`executeNativeJob`)

| Step | Action | Refusal / outcome |
|---|---|---|
| 0 | If `this.nativeFileRuntime !== null`, refuse. | `NATIVE_OWNER_UNSETTLED` → `stop` |
| 0b | Run `nativeBackends.requireFileSelection(entry.selection)` synchronously, before any folder, probe or journal work. A failed or cancelled owned discovery in an earlier job has already dropped the selection (`#drop()`). | `NATIVE_FILE_SELECTION_STALE` → `stop`; the rest become `unprocessed` |
| 1 | Set `jobOwner = {}` and `this.nativeFileJob = jobOwner`. Then `runtime = nativeFiles.createJob({acquireMediaSlot: r => this.acquireNativeFileSlot(jobOwner, r)})` and `this.nativeFileRuntime = runtime`. | — |
| 2 | Run `verifyFolders()`. If `exists(destination)`, skip the item ("Output appeared since preview."). If `reservedPaths` contains it, `PROTECTED_SOURCE`. | as ordinary |
| 3 | `assertSourceMatches(entry, signal, 'before-encode')`. Re-probe: the marker must be `unmarked`, `lookupIdentity` must be null, and the probe fingerprint must equal the contract's. Then `assertSourceMatches(…'after-provenance-check')`. | `INPUT_CHANGED`, `GENERATED_SOURCE`, `NATIVE_FILE_APPLICABILITY_STALE` |
| 4 | `setJobStage('native-preparing')`. `token = await runtime.prepare({contract, input: file, selection, outputId, generationDescription}, {signal})`. This runs the lease, the lease adapter, the R4 root stamp, the full source seal, the pair hash, owned discovery and stage creation. | any runtime prepare code |
| 5 | `provenanceJournal.recordIntent({outputId, sourceIdentity, destination, profileId, generationDescription})`. It now runs **after** `prepare`, so a refusal at prepare (for example a full-SHA mismatch) leaves no pending intent in the `maxPending:128` recovery window. | journal failure → failed |
| 6 | `describe(token)`. Record `ENCODE_STARTED`:<br>• renderer-safe context: `{beta:true, code:'NATIVE_ENCODE_STARTED', contractId, profileId}`<br>• main-only context, `context.nativePrivate`: `{argv, policyId, nativeCellKey, evidenceIds}`<br>The record **must be persisted**; otherwise `OPERATION_DIAGNOSTICS_INCOMPLETE` and no encoder child starts. `entry.actualArgs` is **never** set. | `OPERATION_DIAGNOSTICS_INCOMPLETE` |
| 7 | `setJobStage('encoding')`. `runtime.encode(token, {signal, onProgress})`.<br>Progress is `seconds / (declaredFrames × den / num)`, using `contract.expectedOutput.frameRate` parsed as integers. An event is ignored unless `seconds` is a finite number of 0 or more and the duration is finite and above 0. The value is clamped to [0, 1] and never moves backwards.<br>Record `ENCODE_CLOSED`, with stderr attached under `nativePrivate` rules. | runtime codes |
| 8 | `setJobStage('native-evidence')`. `collect(token, kind)` for the four roles, with raw roles going to a counting sink that retains nothing. | `NATIVE_FILE_FRAME_BYTES`, … |
| 9 | `setJobStage('output-validation')`. `checked = await runtime.validate(token, {signal})`. Record `OUTPUT_CHECKED`, which must be persisted. | `NATIVE_FILE_REFERENCE_REQUIRED`, `NATIVE_ORACLE_*`, `NATIVE_TEMPLATE_*` |
| 10 | `setJobStage('publication')`. Run `verifyFolders()` and the `reservedPaths` check as an early refusal. Then `pub = await runtime.publish(token, checked, {destination, signal, requireDestinationCurrent})`, where `requireDestinationCurrent = async () => { await this.verifyFolders(); if (reserved(destination)) throw PROTECTED_SOURCE; }`. The runtime calls it after the long source assessment and immediately before the link (R3). | `NATIVE_FILE_DESTINATION`, `OUTPUT_FOLDER_CHANGED`, `PROTECTED_SOURCE`, `NATIVE_FILE_PUBLISHED_CHANGED`, source codes |
| 11 | If `pub.published`: `recordPublished(outputId, pub.identity)`, and the item gets `success`, `saved` or `saved-with-warning`. If not: the item gets `skipped` with outcome `destination-collision`. A bookkeeping failure becomes a fixed-text warning. | — |
| F | `finally`: `runtime.close()` with the §4 settle rules applied inline. On any rejection or failed check, keep both fields, set `state.error = NATIVE_MESSAGES.NATIVE_OWNER_UNSETTLED`, record `NATIVE_RUNTIME_CLOSE_FAILED` with the original kept in `nativePrivate`, and return `stop`. Then derive the disposition (below), record `JOB_DISPOSITION` and call `emitState()`. | — |

**Disposition** (`nativeDisposition`). The first matching rule applies. Inputs are the original error code and the runtime snapshot's `publication`, `stageState` and `stageRetained`. The result is visible to the renderer and never includes a path.

| Kind | Rule |
|---|---|
| `published` | `publication === 'verified'` |
| `published-changed` (`published:false`) | `publication === 'committed'` and the code is `NATIVE_FILE_PUBLISHED_CHANGED`: the destination holds bytes that differ from the validated output. It is never deleted and gets no `recordPublished`. A `NATIVE_PUBLICATION_CHANGED` record must persist; if it does not, the batch stops with `OPERATION_DIAGNOSTICS_INCOMPLETE`. |
| `publication-uncertain` (`published:null`) | The code is `PUBLICATION_UNCERTAIN`, or `publication === 'committed'` with any other failure (for example a cancel during the readback). It is never deleted; provenance recovery reconciles the intent later. |
| `retained-completed` | `stageRetained` and `stageState === 'validated'`. This covers a collision, and any refusal before or at the link other than `PUBLICATION_UNCERTAIN`, including a destination that a third party created. |
| `retained-unvalidated` | `stageRetained` and `stageState === 'sealed'` |
| `retained-incomplete` | `stageRetained` and `stageState === 'unsealed'`: the encode was cancelled or failed before the child completed. These are partial bytes, not an output. |
| `stage-unavailable` | anything else |

Every `retained-*` kind sets `item.nativeKeptStages` (an integer) from `keptStages()`.

**Kept-stage bound (lease adapter, inside the slot):**
1. Compare `stateDir` with the composition stamp.
2. Create `native-files` if it is absent, then run `assertOrdinaryPath` on it.
3. Pin the `native-files` stamp when it is first created, and require it unchanged on later leases.
4. Scan it within bounds: at most 64 entries, `lstat` only, and each entry must be an ordinary `.ffmpeg-encoder-*` directory. Anything else is `NATIVE_FILE_STAGE_CHANGED`. Sum the `encoded.mkv` sizes.
5. Refuse with `NATIVE_FILE_STAGE_QUOTA` when 8 or more stages are kept, or when kept bytes exceed 3 GiB, so one more stage of at most 1 GiB stays within 4 GiB. The text is: "Kept native work files have reached their limit. Remove the folders inside native-files in the app's data folder, then try again."
6. Compare `stateDir` again.

All of this runs before any source or pair hash.

**Codes that stop the batch** are decided on the original code (§6); the remaining items become `unprocessed`:
- `NATIVE_FILE_SELECTION_STALE` and `STALE_NATIVE_SELECTION` (step 0b catches a drop caused by job k before job k+1 does any work);
- `NATIVE_OWNER_UNSETTLED`, `NATIVE_FILE_UNSETTLED`, `NATIVE_FILE_SOURCE_UNSETTLED`, `NATIVE_FILE_LEASE_REQUIRED`, `NATIVE_RUNTIME_STALE`;
- `NATIVE_FILE_STAGE_QUOTA`, `NATIVE_FILE_STAGE_CHANGED`;
- any close failure;
- anything for which `sharedFailure(error)` is true.

After a cancel or failure, the item's text gains the fixed sentence `NATIVE_MESSAGES.NATIVE_SELECTION_DISCARDED` ('The native settings check was discarded; run "Check these settings" again.') if `requireFileSelection` now fails. The user is told only when the drop actually happened.

---

## 6. Refusal codes and messages

Main has one frozen table, `NATIVE_MESSAGES`, that maps each code to fixed text with no interpolation. `nativeRefusal(error)` applies these rules, in order:
1. **Control flow uses the original code.** Cancelled, stop, `sharedFailure`, disposition and recovery decisions are all made on `error.code` before any relabelling. `CANCELLED`, `PUBLICATION_UNCERTAIN`, `INPUT_CHANGED`, `NATIVE_SOURCE_*` and `NATIVE_RUNTIME_STALE` keep their meaning.
2. **Known code.** If the code is in the table: `reasonCode = code` and `reason = NATIVE_MESSAGES[code]`.
3. **Unknown code.** Anything else, for example `EACCES`, `EPERM`, `ENOENT` or `ERR_ASSERTION` from `assertOrdinaryPath`, or a `createStage` errno, gives `reasonCode = 'NATIVE_FILE_JOB_FAILED'` with fixed text.
4. **Where the originals go.** The original code, message and cause go only into `context.nativePrivate`. `error.message`, `error.stderr` and `cause` never reach `item.reason`, `item.details`, `state.error`, an IPC envelope or a renderer-readable journal field. `item.details` is never set for native items.
5. **Coverage of entry points.** `executeNativeJob` never throws; anything that escapes becomes rule 3. `prepareNativeItem` sets its own item and does not let a native error reach the shared catch at `:867-875`. The same mapping wraps the refusals from `prepareNativeFileBatch` and `requireNativeStart`.

**The table covers:**
- every literal code raised in `native-file-*.cjs`, `native-backend-service.cjs` and `outputs.cjs`; a test scans those `fail(`/`failure(` literals, so no known code is relabelled;
- the `NATIVE_TEMPLATE_*` and `NATIVE_ORACLE_*` families, by prefix, with one text each;
- the §3 admission codes, `NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED`, `NATIVE_FILE_STAGE_QUOTA` and `NATIVE_SELECTION_DISCARDED`;
- the ordinary codes a native job can raise: `CANCELLED`, `INPUT_CHANGED`, `GENERATED_SOURCE`, `OUTPUT_FOLDER_CHANGED` (whose ordinary message embeds the errno text), `PROTECTED_SOURCE`, `PUBLICATION_UNCERTAIN` and `OPERATION_DIAGNOSTICS_INCOMPLETE`.

Contract reason codes go into `nativeReasons` as before:
- `NATIVE_FILE_PROBE_INVALID`;
- the `NATIVE_FILE` codes with these suffixes: `_SOURCE_SIZE`, `_SINGLE_VIDEO_REQUIRED`, `_SOURCE_CODEC`, `_SOURCE_GEOMETRY`, `_SOURCE_ORIENTATION_OR_SIDE_DATA`, `_SOURCE_COLOR`, `_SOURCE_TIMELINE`, `_SOURCE_CONTAINER`, `_SOURCE_RELATIONSHIPS`, `_SOURCE_DISPOSITION`.

---

## 7. What the renderer sees

**In C1–C4,** only two renderer-reachable things change:
- the diagnostics projection;
- guards on existing channels, which act only while a native plan exists. No production path can create one, because there is no channel and the policies are `[]`.

The fields below are what C3–C4 put in main state. They would reach the renderer through the existing snapshot and details channels only after C5.

- **Snapshot.** `operation:'native-encode'` and `native:{beta, profileId, label, settings}`. `progress.stage` is one of the native stages. Per item: `beta`, `reasonCode`, `nativeReasons[]` (at most 16), the §5 kinds and `nativeKeptStages`.
- **Encoding details.** The details call branches on `entry.native` **before** the ordinary return and returns the frozen `entry.details`. It is identical before, during and after the batch:
```
{ kind:'native-description', beta:true, profileId, label, settings, contractId,
  encoderArgs: contract.encoderContribution.args, expectedOutput: {codec, profile, bitDepth, pixelFormat, width, height, frameRate, target, signal, range, resolution},
  notice:'Native encoder contribution only. Source, stage and device arguments are bound in main at start and kept in main-only diagnostics; this is not a command.' }
```
  It has no `executable`, `args` or `destination` key.
- **Diagnostics** (`encoder:diagnostic-record`, today; `readSession` is projected too). For native events:
  - `context.nativePrivate` reads as `'[main-only]'`;
  - `stderr` reads as `{withheld:true, bytes}`;
  - the message is the table text.
- **Deferred to C6:** `files` (the readiness projection) on native state results, and `nativeRevision` (an integer) in `encoder:update`, so the renderer reloads native state after a `#drop()`.

**Never sent to the renderer:**
- selection tokens, the contract object, policy rows, policy and evidence IDs, references;
- source or output SHA-256 and the published identity;
- stage paths, `ownedRoot`, the full argv, and any device descriptor beyond the existing opaque `deviceId`;
- native stderr, runtime snapshots, and original errno or assertion messages.

---

## 8. IPC and preload

C1–C4 add no channel and change no argument validation. Every channel keeps the existing loop at `ipc.cjs:53-73`.

| Channel | Commit | Change | New refusals |
|---|---|---|---|
| `encoder:diagnostic-record` | C2 | Projected native events (§7) | — |
| `encoder:native-select`, `-refresh`, `-qualify` | C3 | Guard | `NATIVE_FILE_PLAN_ACTIVE` |
| `encoder:start` | C4 | `requireNativeStart` (§3.4) | `NATIVE_FILE_POLICY_REQUIRED`, `NATIVE_FILE_SELECTION_STALE`, `NATIVE_FILE_RUNTIME_UNAVAILABLE`, `NATIVE_BACKEND_BUSY` |
| `encoder:cancel` | C3 | Revokes a ready native plan | — |
| `encoder:encoding-details` | C3 | Native branch first | — |
| `encoder:treat-original`, `encoder:reencode-outputs` | C3 | Guard | `NATIVE_FILE_SOURCE_PERMISSION_REQUIRED` |
| `encoder:update-file-operations`, `-batch-operation-defaults`, `apply-app-defaults-to-batch`, `reprepare-encoding-settings` | C3 | Guard in `requireEditableDraft` | `NATIVE_FILE_OPTIONS_FIXED` |
| every channel that calls `requireIdle` | C2 | Quarantine code (§4) | `NATIVE_OWNER_UNSETTLED` |
| `encoder:prepare-native` (arity 1) | C5, **deferred** | New. Preload `prepareNativeFileBatch(request)`; validation as in §3.2 step 1 | §3.2 |
| `encoder:native-state` and the three native actions; `encoder:update` | C6, **deferred** | `+files`; `+nativeRevision` | — |

No channel or argument accepts policy rows, tokens, paths, argv, devices, budgets or references.

---

## 9. Exact `encoder-service.cjs` seams (ordinary statements untouched)

| Location | Change |
|---|---|
| Constructor `:100-157` | Add the options `nativeFiles = null` and `allowInjectedNativeFiles = false`. If `nativeFiles` is present, it must have a brand; an `'injected'` brand without the allowance fails with `INVALID_NATIVE_FILE_COMPOSITION`. Add the fields `nativeFileJob = null`, `nativeFileRuntime = null` and `nativeSettle = null`. |
| `closeOperationResources` `:172-193` | After `await this.taskPromise`, if `nativeFileRuntime` is set, run `await settleNativeFileRuntime()` and push any failure. This happens before `nativeBackends.invalidate()`. |
| `requireIdle` `:309-312` | One line (§4). |
| `:319`, `:327` | `NATIVE_FILE_PLAN_ACTIVE` guard in select and in `runNativeBackendOperation`. |
| `:360` | Add `acquireNativeFileSlot` and `settleNativeFileRuntime` beside the unchanged `acquireNativeMediaSlot`. |
| `:462` | Native early return. |
| `:544` | Native details branch on `entry.native`, first. |
| `:787` | One dispatch line. |
| `:936-1010` `prepareSourceBatch` | `native` branches for settings and capabilities, `draft = null`, the plan fields, the `outputName` suffix, `state.native`, the `assertOrdinaryPath(plan.output)` check after `verifyFolders`, and the `requireFileSelection` check before `phase = 'ready'`. |
| `:1031` | Native guard. |
| `:1358`/`:1359` | One `requireNativeStart(selected)` call between the two loops. |
| `:1375` | One dispatch block (§4). |
| `:1788-1795` outer `finally` | Drop native entry authority. |
| `:1805-1840` | `preparedNative` revoke branch. |

---

## 10. STRIDE threat model (skill `agentic-council:threat-model`, steps 1–6)

### 10.1 Trust boundaries
- **TB1:** the sandboxed renderer → main, through preload and IPC.
- **TB2:** main → child processes: pinned ffmpeg/ffprobe, the DXGI PowerShell helper and the vendor driver (untrusted output).
- **TB3:** main → filesystem: the user's source and output folders, which others may modify, and `stateDir\native-files`, which main owns but which is still a filesystem object that can be replaced.
- **TB4:** main → durable journals (diagnostics, provenance). The diagnostics journal is **renderer-readable** through `encoder:diagnostic-record`.

### 10.2 Data flows
| DF | Flow |
|---|---|
| DF1 | The renderer sends `{folder IDs, selectionId, revision}` → `prepareNativeFileBatch` (C5 only; deferred). |
| DF2 | The native selection service → token capture → the plan (main → main). |
| DF3 | The fixed catalog → `assess` / `readiness` → admission. |
| DF4 | Source read, seal and hash; owned-root and stage creation (TB3). |
| DF5 | Child argv → ffmpeg/ffprobe/PowerShell; their stdout, stderr and progress → main (TB2). |
| DF6 | Lease, queue, cancellation, quarantine and shutdown. |
| DF7 | Stage → destination publication (TB3). |
| DF8 | Main → renderer status: snapshot, details, diagnostic records (TB1). |
| DF9 | Main → diagnostics and provenance journals (TB4). |

### 10.3 Threats
| ID | DF | STRIDE | Threat | Rating | Mitigation | Negative test |
|---|---|---|---|---|---|---|
| S1 | DF1 | Spoofing | A foreign window, subframe or navigated URL invokes `prepare-native`. | Medium | The channel is deferred. When it lands: the existing sender, frame, URL and arity checks. | IPC-N1 (C5) |
| S2 | DF1/DF2 | Spoofing | A replayed `selectionId`/`revision`, a token-shaped object, or a token captured before a capability refresh. | **High** | Only IDs cross TB1. Main captures the WeakMap-branded token **after** `getCapabilities` and re-checks it before `ready` and at Start. | NS-04, NS-05 |
| S3 | DF6 | Spoofing | Another path obtains the file lease, or the runtime gets a slot outside `running`. | **High** | `acquireNativeFileSlot` binds the job owner, the exact purpose, phase `running`, a single holder and abort checks. | NS-01, NS-02 |
| S4 | DF5 | Spoofing | A replaced or same-size tampered ffmpeg/ffprobe. | Medium | Full SHA-256 pins in `NativeFileRuntimePair`, compared with the selection pins. | Existing runtime tests |
| T1 | DF1 | Tampering | Extra request fields, or accessor/proxy payloads. | **High** | Exactly four data properties; settings come only from the token. | NS-04 |
| T2 | DF4 | Tampering | The source is swapped between preview, start, encode and publication. | **High** | Identity, provenance and fingerprint rechecks; the runtime's full-SHA seal; `requireCurrent`; the completion assessment and publication currentness. | NS-12 |
| T3 | DF7 | Tampering | The output folder is renamed and replaced (for example by a junction) during the long assessment, sending the link into the input folder or `stateDir`. Also: a UNC or mapped output, a pre-created or reserved destination, or a destination inside the owned root. | **High** | Plan-time `#destination` rules on `plan.output` and the names (§3.2 step 3). `requireDestinationCurrent` (folder identity, reserved paths) plus a `#destination` re-run immediately before the link (R3). No-overwrite link or `COPYFILE_EXCL`. Full-SHA readback. | NS-13, NF-C6 |
| T4 | DF4 | Tampering | `stateDir` or `native-files` is replaced between the lease adapter's check and the runtime's first root stamp. | **High** | `stateDir` is stamped at composition; `native-files` is pinned when first created; the adapter compares both inside the slot; R4 stamps the root immediately after the lease; `#rootCurrent`/`#stageCurrent` run before each step. | NF-C4 |
| T5 | DF3 | Tampering | Injected policy rows or an injected runner reach production composition, including through a spread `opts`. | **High** | The production factory accepts exact keys only. Injection goes only through `createTestNativeFileControls` (brand `injected`). The service refuses injected controls without `allowInjectedNativeFiles`. `main.js` asserts the `'production'` brand and `policyCount === 0` at startup. | NS-20, NF-C1 |
| T6 | DF5 | Tampering | Crafted media makes probe JSON or child output pose as evidence, or makes progress values hostile. | Medium | Bounded inert parsers, the exact-reference oracle, frame-byte equality, and clamped finite progress. | Existing oracle/template tests, NS-23 |
| R1 | DF9 | Repudiation | A native encode runs with no durable record of its argv or policy. | **High** | `ENCODE_STARTED` (with argv and policy in `nativePrivate`) and `OUTPUT_CHECKED` must persist. The provenance intent is recorded after `prepare` and before the encoder child; the published identity after publication. `NATIVE_PUBLICATION_CHANGED` must persist. Then `JOB_DISPOSITION`. | NS-14 |
| R2 | DF7 | Repudiation | Dispute over which policy produced an output. | Low | The native-v2 marker, plus `referenceId` and `policyId` in the main-only journal context. | — |
| I1 | DF8 | Information disclosure | Tokens, policy rows, hashes, stage paths, argv, stderr or path-bearing errno and assertion messages leak through the snapshot, details, IPC errors or diagnostic records. | **High** | Fixed-text table with classification on the original code (§6); details come from frozen `entry.details` and never from `actualArgs`; the diagnostics projection withholds `nativePrivate` and stderr. | NS-09 |
| I2 | DF9 | Information disclosure | The on-disk journal holds native argv, the owned root and stderr. | Low | A main-only audit record; renderer reads are projected; the redacted export already omits unknown groups and stderr. | NS-09 |
| D1 | DF5 | Denial of service | A hung child, oversized output or a flood of pipe bytes. | Medium | The policy budget enforced by the runtime; cancel aborts. | Existing runtime tests |
| D2 | DF6 | Denial of service | Runtime close fails, so the lease is held and every action refuses. | Medium | Quarantine on any rejection or unsettled snapshot. `NATIVE_OWNER_UNSETTLED` with honest text. A single-flight retry on the next admission attempt and at shutdown. Permanent unknown ownership needs a restart (residual). | NS-16 |
| D3 | DF4 | Denial of service | Kept native stages (up to 1 GiB each) fill `stateDir` unseen. | Medium | Count and byte quota in the lease adapter (`NATIVE_FILE_STAGE_QUOTA`), checked before any hash; `nativeKeptStages` on items; `retained-incomplete` disposition. | NS-22 |
| E1 | DF1→DF7 | Elevation of privilege | Start or publication without a policy ("Beta enables Start"). | **High** | Readiness refusal before any work; the synchronous Start recheck before any state change; the runtime refuses `[]`. | NS-03, NS-10 |
| E2 | DF2/DF3 | Elevation of privilege | AMF reaches file encoding by substitution. | **High** | Refused at readiness, at `captureFileSelection` (`:197`) and at runtime `prepare` (`:98`). | NS-06 |
| E3 | DF1 | Elevation of privilege | The native branch changes ordinary args, defaults or CQ29. | **High** | A separate operation and job function, limited to the §9 seams. | NS-18 |
| E4 | DF4 | Elevation of privilege | Generated or suspicious outputs are re-encoded natively. | Medium | Native plans refuse re-encode and treat-original; the runtime refuses any source that is not `unmarked`. | NS-08 |
| E5 | DF3/DF7 | Elevation of privilege | A reference-less row produces a published file. | **High** | Admission and `validate` (`:160`) both refuse. | NS-07 |
| E6 | DF2/DF6 | Elevation of privilege | A native refresh, select or qualify interleaves with a ready or running native plan. | **High** | `requireIdle`; `NATIVE_FILE_PLAN_ACTIVE`; `#selectionCurrent`; the step 0b recheck. | NS-05, NS-17 |

### 10.4 Residual risks (accepted, with justification and monitoring)
- **L-IDENTITY-ASSURANCE.** The QSV device binding is an ordinal plus a descriptor plus DXGI inventories before and after. Disclosed; not a new gate.
- **Path-based link window.** After `requireDestinationCurrent` and the `#destination` re-run, `fs.link`/`copyFile` remain path-based, as in the ordinary path. The window is a few syscalls with no hashing in between. Monitoring: the post-link identity check and the full-SHA readback.
- **Permanent quarantine.** Unknown child, lease or source ownership keeps admission refused until restart. This is preferred over a false release. Monitoring: `NATIVE_RUNTIME_CLOSE_FAILED`.
- **Kept stages.** These are bounded by the quota. There is no cleanup UI (§13); the user removes folders by hand when told to.
- **Recovery reads markers only.** Provenance recovery lists a `published-changed` destination as `matching (pending)`, because its marker matches. The persisted `NATIVE_PUBLICATION_CHANGED` record is authoritative, and since no `recordPublished` exists, no identity is ever adopted from it.
- **A cancel discards qualification.** A cancel or failure during owned discovery drops the selection. The user is told when it happened (§5).
- **No production evidence.** Every positive path is exercised only with injected synthetic policies and children.

---

## 11. Edge cases and failure modes

| # | Case | Expected behaviour | Test |
|---|---|---|---|
| 1 | This machine (no AMD/Intel device) | Readiness is `DISCOVERY_UNOBSERVED` + `POLICY_REQUIRED` before the capability check, and `HARDWARE_UNAVAILABLE` + `POLICY_REQUIRED` after it | NF-C3 |
| 2 | Catalog `[]`, prepare called anyway | Throws `reasons[0]`: `NATIVE_HARDWARE_UNAVAILABLE` on this machine, `NATIVE_FILE_POLICY_REQUIRED` with a verified QSV fixture. The message lists every reason. No capability check, readdir, inspection, lease or child; the phase is unchanged | NS-03 |
| 3 | AMF selection | `AMF_EFFECTIVE_PROPERTIES_UNOBSERVED` shown and `CAPABILITY_UNVERIFIED` hidden | NS-06, NF-C3 |
| 4 | HEVC/AV1 or 10-bit QSV selection | `NATIVE_FILE_REQUEST_UNSUPPORTED` | NF-C3 |
| 5 | Native refresh while a native plan is ready | `NATIVE_FILE_PLAN_ACTIVE`; Cancel revokes the plan | NS-05, NS-19 |
| 6 | Owned discovery fails or is cancelled in job k of n | Job k fails; job k+1 stops at step 0b with zero `verifyFolders`, ffprobe or `recordIntent` calls; the rest are unprocessed; the item says the check was discarded | NS-17 |
| 7 | Source outside the contract | Per-file `unsupported` with `nativeReasons` | NS-08 |
| 8 | Full SHA differs from the policy | `NATIVE_FILE_SOURCE_UNQUALIFIED`; no stage, no pending intent; lease released | NS-12, NS-14 |
| 9 | Destination exists at preview / appears mid-job | `skipped` / `destination-collision` with `retained-completed` | NS-13 |
| 10 | Input and output are the same folder | `NATIVE_FILE_SAME_FOLDER_UNSUPPORTED` | NS-04 |
| 11 | Output on another volume than `stateDir` | Verified copy plus full-SHA readback | NS-11 |
| 12 | Output folder is UNC, a mapped drive, inside `native-files`, or has a reparse ancestor | `NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED` at plan time | NS-04 |
| 13 | Cancel while waiting for the lease or during hashing | `CANCELLED`; close releases once | NS-15 |
| 14 | Cancel during encode / evidence / validate | `retained-incomplete` / `retained-unvalidated` / `retained-unvalidated` | NS-15 |
| 15 | Cancel during the post-publication readback | `publication-uncertain` (`committed`) | NS-15, NS-21 |
| 16 | `close()` rejects with any error (including from `#source.close` or `#pair.close`), or resolves while still holding something | `stop`; `NATIVE_OWNER_UNSETTLED` from `requireIdle` for ordinary work too; the next admission attempt retries once; on success the slot is released exactly once and admission reopens; permanent ownership loss stays quarantined | NS-16 |
| 17 | Renderer crash mid-job | `cancelCurrent` → same drain as case 14 | NS-15 |
| 18 | Quit mid-job | Close prompt → `cancelCurrent` → `closeOperationResources` settles the runtime first | NS-16 |
| 19 | Diagnostics unavailable | No encoder child; lease released | NS-14 |
| 20–21 | Settings saved / folder re-chosen while ready | Plan kept / dropped | NS-19 |
| 22 | `recordPublished` fails | Saved, with a fixed-text bookkeeping warning | NS-11 |
| 23 | Oracle reference mismatch | `retained-unvalidated`; the destination never appears | NS-07 |
| 24 | Ordinary batch after a native batch | Slot free, no `state.native` leak, ordinary argv unchanged | NS-18 |
| 25 | Clock jump | `NATIVE_TOOL_CLOCK` | Existing tests |
| 26 | Legacy-suffix unmarked source | `ambiguous`; treat-original refused | NS-08 |
| 27 | Output folder swapped for a junction during a slowed `assessCompleted` | Refused before the link (`OUTPUT_FOLDER_CHANGED` or `NATIVE_FILE_DESTINATION`); no name is created in the input folder or `stateDir`; `publication = 'not-attempted'`; `retained-completed` | NS-13 |
| 28 | Pre-link refusal, then a third party creates the destination | `retained-completed`, not uncertain | NS-21 |
| 29 | Published bytes change after the link | `published-changed`; persisted record; no `recordPublished`; never deleted | NS-21 |
| 30 | Capabilities not cached at prepare | Refresh drops the selection → `STALE_NATIVE_SELECTION` with re-check text; no plan | NS-05 |
| 31 | Start refused | Items stay `ready`, phase `ready`; a later valid Start works | NS-10 |
| 32 | Kept-stage quota reached | `NATIVE_FILE_STAGE_QUOTA` before any hash; slot released | NS-22 |
| 33 | Path-bearing errno or assertion (link `EACCES`/`EPERM`, `assertOrdinaryPath`, `mkdtemp`) | `NATIVE_FILE_JOB_FAILED` with fixed text; the original only in `nativePrivate` | NS-09 |
| 34 | Progress `NaN`, `Infinity`, negative or null | Ignored or clamped; the snapshot stays finite in [0, 1] | NS-23 |

---

## 12. Implementation plan (small, testable commits; the root writes, reviews and commits)

**Every commit:**
- Copy each edited file with preserved history to `artifacts/v0.7/claude-reentry-2026-10-29/before-source/`.
- Use `/evidence-run` receipts whose `--covers` lists the edited sources.
- Run `/security-review` on C1–C4 and get an independent `reviewer` pass.
- Stage explicit paths only.
- Run the full `npm test` at C4.

### C1. Add a pure native file admission check, publication facts and fixed controls
- **Files:** `src/native-file-runtime.cjs` (R1–R4), new `src/native-file-controls.cjs`, `tests/native-file-controls.test.cjs`, plus added tests in `tests/native-file-runtime.test.cjs`.
- **Tests:**
  - **NF-C1:** the default catalog is frozen and empty; construction is inert (no `native-files`, zero runner calls). The production factory refuses `policies`, `run`, unknown keys and a spread `opts` carrying either. The two brands are distinct.
  - **NF-C2:** `assess().reasonCodes[0]` equals `prepare`'s code for every refusal fixture, with zero lease or runner calls.
  - **NF-C3:** readiness order and hiding for: discovery unobserved, no device, no selection, AMF, HEVC/10-bit, unverified, empty catalog, reference-less.
  - **NF-C4:** `stateDir` or `native-files` replaced between the adapter check and R4, or later, is refused, and the slot is released once.
  - **NF-C5:** the publish receipt's `identity` equals `readSourceIdentity(destination)`.
  - **NF-C6:** R3 order (callback after `requirePublicationCurrent`, then the `#destination` re-run, then the link); a changed canonical result refuses; the `publication` and `stageState` transitions.
  - **NS-09a:** every literal code in the scanned modules is in `NATIVE_MESSAGES`.
  - The 27 existing runtime tests pass **unedited**.
- **Limits:** no service wiring.

### C2. Give native file jobs a main-owned slot, quarantine and diagnostics projection
- **Files:**
  - `src/encoder-service.cjs`: constructor, `requireIdle`, `acquireNativeFileSlot`, `settleNativeFileRuntime`, `closeOperationResources`;
  - `src/diagnostics.cjs`: `rendererEvent`;
  - `main.js`: production composition and the startup assertion;
  - `tests/native-file-service.test.cjs`.
- **Tests:**
  - **NS-01:** the slot refusal matrix.
  - **NS-02:** `acquireNativeMediaSlot({purpose:'native-file-runtime'})` still refuses.
  - **NS-16a:** with a stub runtime whose close rejects (both `AggregateError` and a plain error) or resolves unsettled, `requireIdle` throws `NATIVE_OWNER_UNSETTLED` and not `BUSY`; the retry is single-flight; success releases exactly once.
  - **NS-18:** the ordinary suites pass unchanged with `nativeFiles` composed, and the ordinary argv is deep-equal with and without it.
  - **NS-20:**
    - (a) an identifier scan finds `createTestNativeFileControls` and `allowInjectedNativeFiles` in no file under `main.js`, `preload.js` or `src/` except `native-file-controls.cjs` and the service constructor;
    - (b) a service given injected controls without the allowance refuses at construction;
    - (c) the startup assertion's function refuses an injected or non-empty brand.
  - **NS-09b:** `diagnostic-record` and `readSession` on a synthetic native event withhold `nativePrivate` and stderr text; the redacted export omits them.
- **Limits:** no batch can be prepared yet.

### C3. Prepare policy-gated native file batches in main
- **Files:** new `src/native-file-workspace.cjs` (`prepareNativeItem`, `nativeGenerationDescription`, `nativeDetails`), `src/encoder-service.cjs` (`prepareNativeFileBatch`, the `prepareSourceBatch` branches, the `:787` dispatch, the §3.5 guards, the cancel revoke, the details branch), tests.
- **Tests:**
  - **NS-03:** thrown code = `reasons[0]` (cases 1–2); `POLICY_REQUIRED` is always among the reasons; zero capability, readdir, inspection or runner calls; phase unchanged.
  - **NS-04:** request shape, same folder, and the output path rules (case 12).
  - **NS-05:** stale selection; select, refresh and qualify refused while ready; the token is captured after uncached capabilities (case 30); `requireFileSelection` runs before `ready`.
  - **NS-06, NS-07a, NS-08, NS-19:** as before.
  - **NS-09c:** a deep scan of the snapshot and details — during ready, during the batch and **after the outer `finally`** — finds no token, policy keys, 64-hex hashes, stage or owned-root paths, argv, `executable` or `destination`.
- **Limits:** Start still refuses native plans with `NATIVE_FILE_START_UNWIRED`, which C4 removes.

### C4. Run native file jobs through the one queue, publishing only through the runtime
- **Files:** `src/native-file-workspace.cjs` (`executeNativeJob`, `nativeDisposition`), `src/encoder-service.cjs` (`requireNativeStart`, the `:1375` dispatch, the outer-`finally` authority drop). The runtime test fixture moves to `tests/native-file-fixture.cjs`; this is a pure move, and the pass count must not change.
- **Tests:**
  - **NS-10:** forged or stale Start with zero runtime constructions; case 31.
  - **NS-11:** an injected exact-reference job publishes once, records provenance with the identity, and leaves no path in the snapshot; also the cross-volume fixture.
  - **NS-12:** a source change before the lease or after validate.
  - **NS-13:** cases 9 and 27, the latter with an injected slow `assessCompleted` and a folder swap.
  - **NS-14:** an unpersisted `ENCODE_STARTED` means zero encode invocations; a refusal at prepare leaves no pending intent.
  - **NS-15:** cancel at each stage, including the readback.
  - **NS-16b:** a real runtime close failure followed by a retry; case 18.
  - **NS-17:** case 6.
  - **NS-07b:** reference mismatch.
  - **NS-09d:** path-bearing fs fixtures (case 33) give fixed text in `item.reason`, `state.error`, the `JOB_FAILED` and `ENCODE_STARTED` records as read back, and the Start error envelope.
  - **NS-21:** the publication classification matrix (cases 15, 28, 29).
  - **NS-22:** quota and count.
  - **NS-23:** progress clamp.
  - Full `npm test`.
- **Limits:** still no renderer path. The native file flow is reachable only from injected tests, which matches production reachability under `[]`.

### C5–C6. Renderer channel and UI: deferred, owner scope gate
These commits would add `encoder:prepare-native` plus preload `prepareNativeFileBatch`, with tests IPC-N1 and IPC-N2 and the channel-inventory update. They would also add `files` and `nativeRevision`, the "Prepare files with this selection · Beta" button, the reason list and the native stage and outcome labels. Under `[]`, the channel could only ever refuse at §3.2 step 4 and the button could never be enabled, so they add trust surface with no production function. They are **not scheduled**. The root writer asks Ahmed for a scope decision in C7 and implements them only after approval, using the specification above.

### C7. Record the integration and the remaining external blockers
Under PBS, update:
- tracker 25 rows P01–P04 (evidence notes only; texts and order are never edited);
- `01_Current_State`, `10_Continuation_State`, the Execution Index, the dated Execution Summary and `06_SESSION_SUMMARY`;
- a **P closure record**, listing B-AMF-PRODUCER, B-QSV-HARDWARE and L-IDENTITY-ASSURANCE as the external limits, that production policies remain `[]`, and the open owner question on C5–C6;
- a Notion overlay with readback.

The P04 cross-feature check runs here against the C1–C4 bytes.

---

## 13. Out of scope (unchanged by this design)
- Any production policy row, reference, qualification campaign or real AMD/Intel run. The AMF producer and its owner disposition.
- C5–C6 until the owner approves them.
- HEVC/AV1, 10-bit, audio or multi-stream sources, ranges, resolution changes, per-file option edits, and same-folder output for native jobs.
- Fixed-NTFS storage eligibility for native output folders (see A9 below).
- Open/reveal actions for native outputs (no `outputAccess` token), persistent native defaults, and a kept-stage cleanup UI.
- Ordinary CPU/NVIDIA changes, Archive CQ29, the benchmark, HDR P05–P09 (no reseal), packaging, dependency or runtime upgrades, and Security Cloud.
- Any claim that P01, P02 or P03 is complete. This design closes software obligation 7 only.

---

## Review disposition

Every finding was checked against the cited source before it was applied.

**First review (A):**

| Finding | Disposition | Where |
|---|---|---|
| A1, stale destination check before the link | **Accepted.** `requireDestinationCurrent` plus a `#destination` re-run immediately before `publishOutput` (R3). | §2 R3, §5 step 10, T3, case 27 |
| A2, path-bearing messages | **Accepted.** One frozen table, unknown codes become `NATIVE_FILE_JOB_FAILED`, the original only in `nativePrivate`. | §6, invariant 9, NS-09a/d |
| A3, journal readable unredacted | **Accepted.** `rendererEvent()` in `read` and `readSession`. `readSession` has no IPC channel today but is projected anyway, because it is a public reader. | §2, §7, NS-09b |
| A4, `actualArgs` leak | **Accepted.** `actualArgs` is never set; the branch is on `entry.native`; details are frozen at prepare and tested after the batch. | §3.3, §5 step 6, NS-09c |
| A5, publication uncertainty conflated | **Accepted.** Runtime `publication` fact (R3); new `published-changed` kind with a persisted record. | §5 dispositions, NS-21 |
| A6, close handling too narrow | **Accepted.** Any rejection quarantines; snapshot and slot checks after a resolved close. | §4, §5 F, NS-16 |
| A7, composition not proven at runtime | **Accepted.** Exact-key production factory, separate test factory, `injected` brand, service refusal, and a startup assertion added on top. | §2, §9, T5, NS-20 |
| A8, token captured too early | **Accepted.** Capabilities first; capture runs synchronously after; recheck before `ready`. | §3.2 steps 5–8 |
| A9, output not drive-qualified at plan time | **Partly accepted.** The `#destination` rules and a reparse check now apply to the output folder at plan time. **Rejected: the storage-eligibility part.** `StorageEligibility.check` is file-stamp-based and exists for inspection-cache reuse. A remote writer to a local folder shared over SMB is not stopped by the drive type, and is handled by A1's pre-link check. Requiring fixed NTFS would also refuse removable and exFAT outputs that the runtime's copy-plus-readback path already publishes safely. | §3.2 step 3, §13 |
| A10, owned root stamped late | **Accepted.** `stateDir` is stamped at composition, `native-files` is pinned, and R4 runs `#rootCurrent` right after the lease. | §2, T4, NF-C4 |
| A11, progress unchecked | **Accepted.** Contract frame rate, finite values only, clamped and monotonic. | §5 step 7, NS-23 |

**Second review (B):**

| Finding | Disposition | Where |
|---|---|---|
| B1, token captured before capabilities | **Accepted** (same as A8). | §3.2 |
| B2, output-folder rules | **Accepted** (same as A9, without storage eligibility). | §3.2 step 3 |
| B3, uncertain decided by `exists()` | **Accepted.** The R3 `committed` fact is now an allowed runtime change. | §2 R3, §5 |
| B4, generic BUSY until restart | **Accepted.** `requireIdle` throws `NATIVE_OWNER_UNSETTLED`, with a single-flight retry on the next admission attempt; any rejection counts. | §4 |
| B5, the next job does work before going stale | **Accepted.** Step 0b, plus conditional discarded-check text. | §5 |
| B6, `requireNativeStart` placement | **Accepted.** Between `:1358` and `:1359`; a refused Start leaves items `ready`. | §3.4, NS-10 |
| B7, kept stages unbounded and unseen | **Accepted.** `retained-incomplete`, a quota code, and `nativeKeptStages`. | §5, D3, NS-22 |
| B8, misleading readiness text and stale renderer state | **Accepted.** `NATIVE_DISCOVERY_UNOBSERVED` and the hiding rules. The `nativeRevision` push is accepted but moves with the deferred C6, because there is no renderer consumer before then. | §3.1, §7 |
| B9, thrown code vs tests | **Accepted.** The thrown code is `reasons[0]`, and the tests assert it per fixture. | §3.2 step 4, NS-03 |
| B10, relabelling breaks control flow | **Accepted.** Classification uses the original code; known codes are kept; errno fixtures added. | §6, NS-09d |
| B11, intent before prepare | **Accepted.** Moved after `prepare` and before encode. | §5 step 5, NS-14 |
| B12, C5–C6 out of production reach | **Accepted.** Deferred to an owner scope decision, which C7 asks for. Obligation 7 does not need them. | §12, §13 |

## C4 amendments (November 1, 2026, root)

Root decided these points during C4 (Codex jobs `c4-work`, `c4-review`, `c4-fixes` and `c4-rereview`; receipts under `artifacts/v0.7/codex/`). Where they differ from the text above, they replace it.

| Point | Decision | Section |
|---|---|---|
| Progress units | `state.progress.percent` uses the ordinary unit, 0–100, capped at 99 like ordinary jobs. It stays finite and never moves backwards. The "[0, 1]" in step 7 and NS-23 is read this way, because the renderer field it would feed in C6 is the ordinary one. | §5 step 7, NS-23 |
| Policy evidence | On an admissible result, `assess()` also returns the matched policy's `evidenceIds` as a frozen copy. The entry keeps them main-only. `ENCODE_STARTED` records them in `nativePrivate.evidenceIds`, and the selection's own evidence ID separately as `selectionEvidenceId`. | §5 step 6 |
| Successful-encode stderr | Not kept as text. A successful `encode()` returns only the owned effective observation, and `ENCODE_CLOSED` records that observation, including its stderr hash. Keeping the text would widen the runtime owner's API, which C4 leaves unchanged. Failure stderr is kept in the journal's top-level `stderr` field (256 KiB bound, withheld from the renderer), as for every native event. | §5 step 7 |
| Record failures after the disposition | A derived disposition is a publication fact and stays. If a later record cannot be saved (the published-changed record, `JOB_DISPOSITION`, or the settle's own record), the batch stops with `OPERATION_DIAGNOSTICS_INCOMPLETE`. Only a disposition that could not be derived falls back to `stage-unavailable`, with `NATIVE_FILE_JOB_FAILED`. A confirmed settle stays confirmed. | §5 step F |
| Settle never rejects | A failure of the settle's own record never changes its result and never rejects. So `requireIdle`'s unawaited retry and the shutdown cleanup always continue. | §4 |
| Logged for C7 | Two ordinary 0.7 behaviours outside C4 that show the app data folder path to the renderer: `diagnosticWarning` copies the journal's initialization error text (`encoder-service.cjs`, the two `recordIncident` failure paths), and the diagnostics `status.directory`. Neither is a native path; C7 decides. | C7 |
