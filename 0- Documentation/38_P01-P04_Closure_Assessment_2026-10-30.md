# P01–P04 closure assessment — October 30, 2026

**Status:** this is an assessment record written for the root writer and for Ahmed. It is not milestone acceptance and not a tracker edit. It grants no permission and creates no policy, reference row, Ready state, Start or publication authority. No P row is closed by it.

**Baseline (read-only observation):**
- HEAD `9a2d27e` on `codex/v0.7-candidate`.
- The working tree has no changes under `src/`, `tests/`, `ui/`, `main.js` or `preload.js`. The native file stack is as committed at `253c567`.
- No tests, media, device, GUI or Git-writing commands ran for this assessment. Every test result cited below comes from an existing receipt and applies only to the bytes named in that receipt.

**Sources:**
- Tracker 25, rows P01–P04 (`25:74-77`); Goal 23 (`23:98`); Plan 31 (`31:171, 31:182, 31:220-223`).
- Amendment 33 (`33:17-18, 33:41-43`); record 35 (`35:18, 35:23, 35:40-41`).
- `native-file-dependency-disposition.md` (dependency-disposition); `native-runtime-next-contract-review.md` (contract review); `native-file-oracle-design.md`; `native-product-integration-design.md`; `native-service-integration-design.md` (service design). The 2026-10-26 files are under `artifacts/v0.7/non-hdr-completion-2026-10-26/`; the service design is in this folder.
- Execution summary `2026-10-29_Claude_Continuation_and_Native_Runtime.md`.

---

## 1. Verdict in one table

| Row | Software still missing that can be built now | External blockers | Recommended label now | Label once C1–C4 and C7 land |
|---|---|---|---|---|
| P01 | Service lifecycle C1–C4 (including runtime changes R1–R4); hardware procedure; HEVC/AV1/10-bit file contracts (scope question, §7 D3) | B-AMF-PRODUCER (owner disposition); no AMD hardware; no qualified reference or policy | **PARTIAL — software incomplete; AMF file execution specifically unavailable** | **PARTIAL — externally blocked** (finite H.264 route software complete) |
| P02 | The same C1–C4; hardware procedure; HEVC/AV1/10-bit file contracts (§7 D3) | B-QSV-HARDWARE; no qualified reference or policy; L-IDENTITY-ASSURANCE disclosed | **PARTIAL — software incomplete; actual RC verification unverified** | **PARTIAL — externally blocked** |
| P03 | File-level cell use at preparation and Start (C3–C4) | Without hardware, no cell can reach `verified` from a real device; AMF cells also need B-AMF-PRODUCER | **PARTIAL — sample-cell software integrated; file lifecycle pending** | **PARTIAL — externally blocked (`verified` unobservable locally)** |
| P04 | Ordinary-argv recheck against the C1–C4 bytes (NS-18, C7) | None | **PARTIAL — compatibility checked at `253c567`; recheck owed** | **PARTIAL — cross-feature acceptance owed at Slice 6 / S (not blocked)** |

No row may be labelled COMPLETE. P01–P03 require real vendor evidence that cannot exist on this machine (`23:98`: "real vendor execution remains unverified until tested on that hardware"). P04's final cross-feature acceptance is scheduled for Slice 6 (`31:223`, slices "2/6"; `31:184`).

The gap between "software incomplete" and "externally blocked" is exactly obligation 7 of the contract review (the normal service lifecycle), plus the runtime corrections R1–R4 that the service design found. All of it is implementable with injected tests (contract review `:70`; dependency-disposition `:46`).

---

## 2. Shared native file stack (P01–P03): the seven software obligations

Contract review `:62-70` lists seven prerequisites and states "All seven are implementable software work". Their state at `253c567`:

| # | Obligation | State | Evidence |
|---|---|---|---|
| 1 | Pure file policy/operation owner, default frozen `[]` | **Partial** | `DEFAULT_NATIVE_FILE_POLICIES = Object.freeze([])`, the strict `policy()` row validator and exact unique matching all live inside `NativeFileRuntimeOwner` (`native-file-runtime.cjs:17, 24-36, 96-103`). Missing: a pure admission check that does no I/O (service design R1, `assessNativeFileAdmission`), and a production factory with exact-key composition, a brand and a startup `policyCount === 0` assertion (`src/native-file-controls.cjs`, design C1/C2). |
| 2 | Paired-tool owner | **Done** | `src/native-file-runtime-pair.cjs`. A failed `FileHandle.close` is latched so the lease stays held (2026-10-29 summary). |
| 3 | Owned discovery `run` path | **Done** | `native-backend-controls.cjs:18-20` passes `run` through. The runtime's `#observe` (`native-file-runtime.cjs:73-90`) allows only the two fixed inventory commands, and its refusals never reach the shared registry. |
| 4 | Private owned-child adapter | **Done** (as `NativeFileToolOwner.invoke`) | `native-file-tools.cjs:30-117`: exactly one child, exit code 0, both pipe EOFs, settled sinks and matching captures. The contract review permits equivalent naming (`:26`). |
| 5 | Complete finite evidence provider | **Software done; no reference** | Four evidence roles (`native-file-runtime.cjs:138-153`), the finalized Matroska template observer (`native-file-template.cjs`) and the exact-reference oracle (`native-file-oracle.cjs`), wired into `validate` (`:157-172`). With no reference row, `validate` refuses with `NATIVE_FILE_REFERENCE_REQUIRED` (`:160`). Plan-time `describeNativeFileSource` exists (`native-file-contract.cjs:83`) but has no service caller yet. |
| 6 | Source final-currentness | **Done** (equivalent name) | `assessCompleted` + `requirePublicationCurrent(assessment)` (`native-file-source.cjs:136, 155`), called in `publish` (`native-file-runtime.cjs:190-191`). |
| 7 | Normal service lifecycle | **Missing** | Nothing outside `tests/native-file-runtime.test.cjs` imports the runtime. The integration is designed, not built: service design C1–C4 (§12), with tests NF-C1…NF-C6 and NS-01…NS-23. |

**Runtime corrections the service design found in the committed bytes (also missing software):**
- **R1:** a pure admission check whose first refusal code equals `prepare`'s.
- **R2:** `publish` should return the published identity (computed at `:194` and currently discarded).
- **R3:** destination currentness immediately before the link. Today `#destination` runs before the long source assessment, which leaves a junction-swap window (threat T3).
- **R4:** stamp the owned root right after the lease, before source and pair hashing.

**Carried-forward items (implementable now):**
- The lower-priority test gaps from the four-lens review journal (2026-10-29 summary).
- The Proxy re-read hardening in the tool owner, which was scheduled for the service-wiring step.

**Verification receipts for the committed native bytes:**
- `artifacts/v0.7/evidence/20261029T235425Z_full-suite-native-checkpoint`: runtime 27/27, template 12/12, oracle 6/6, tools 18/18. The complete suite ran 2,041 tests: 2,031 pass, 5 host-link skips and 5 failures. The 5 failures are exactly the pre-existing suspended HDR/Full exact-byte catalogs, which fail identically on clean `f6f1f11`.
- Earlier tree checks: `20261029T181725Z_native-file-focused-final-tree` (91/91) and `20261029T181746Z_native-consumers-final-tree` (176 pass, 1 host skip). These cover the pre-fix bytes only.

**Production reachability today:** zero. The runtime is unwired and the policy catalog is `[]`. Every positive path has been exercised only with injected synthetic policies and children (service design §10.4).

---

## 3. P01 — AMD AMF

**Requirement (tracker 25, verbatim):** "Useful AMF H264/HEVC/AV1 native CQP/QVBR adapters, explicit device, per-depth/RC support"

### Software implemented (evidence)
- **Adapters.** Pure AMF H264/HEVC/AV1 adapters with CQP/QVBR modes and per-codec depth validation: H264 8-bit; HEVC/AV1 8- and 10-bit (`backend-adapters.cjs:53-55, 87-88, 140`). Historical adapter tests are retained (`25:74`).
- **Explicit device.** The device is part of the capability policy and of the cell key (`backend-adapters.cjs:221-247`). The file command takes the device only from the current genuine selection (`native-file-runtime.cjs:115`).
- **Fail-closed AMF observation boundary.** `AMF_EFFECTIVE_PROPERTIES_UNOBSERVED` is enforced at the probe (`backend-probe.cjs:144, 232`), the observation collector (`backend-observation.cjs:186, 198`), file-selection capture (`native-backend-service.cjs:197`) and runtime `prepare` (`native-file-runtime.cjs:98`). The final vendor suite (60/60) plus an independent review verify that it starts zero probe children (Slice 4a receipt).
- **Settings and labels.** The sample Settings path is wired through main/IPC/preload (`bb53c05`). The "AMD AMF — Beta" label is visible (`ui/renderer.js:795`; `ui/index.html:66`).
- **File command.** The finite original-contract file builder constructs exact AMF CQP/QVBR argv (`8ef7ad1`; 22 focused and 68 separate compatibility passes). Descriptive native-v2 provenance is in place (128 focused passes).
- **Shared stack.** The runtime, oracle, validate and publish code from §2 applies to AMF as well, but AMF is refused before any file child runs.

### Software still missing
1. **Service lifecycle C1–C4** (§2, obligation 7, and R1–R4). For AMF this includes:
   - readiness reason 5, with fixed text calling it "a missing producer, not missing hardware";
   - test NS-06, which shows AMF refused at readiness, capture and `prepare` with no substitution (service design §3.1, E2).
2. **Hardware qualification procedure.** Slice 4 requires "Genuine AMF/QSV collectors plus deterministic tests/hardware procedure" (`31:182`). A search of the repository found no written hardware procedure (private Planning was searched read-only). This is documentation and design work that needs no hardware.
3. **HEVC/AV1 and 10-bit file contracts are absent.** The file contract admits only `h264-amf`/`h264-qsv`, 8-bit, Matroska, source resolution, a fixed 1280×720 expected output and video only (`native-file-contract.cjs:58, 140`). The reviewed designs chose this finite envelope on purpose (dependency-disposition `:38`; service design §13). Other requests are refused with a specific code, not stripped. Whether P01's "H264/HEVC/AV1 … per-depth" needs HEVC/AV1/10-bit **file** contracts before P can be called software-complete is a scope question for Ahmed (§7, D3). Sample-level adapters and cells already cover all three codecs.

### External blockers and exactly what each blocks
- **B-AMF-PRODUCER** (dependency-disposition `:45`; `33:17`). The pinned CLI has no complete same-component producer of effective RC, quality, preset or runtime values. "Requested argv, setter success or another helper session cannot substitute."
  - It blocks every AMF effective-mode receipt, sample or file. Without one, no AMF cell can become `verified`, no AMF file can be admitted and no AMF output can exist.
  - Removing it needs either a genuine producer or an explicit reviewed technical disposition, which is an owner gate (`35:23`). Until then the route stays "specifically unavailable" (dependency-disposition `:56`).
  - It is "an observability limitation, distinct from absent AMD hardware" (`33:17`): AMD hardware alone would not remove it.
- **No local AMD hardware.** This blocks actual AMF discovery, initialization, encoding and any real evidence, even if a producer existed.
- **No independently qualified reference or file policy** (`33:43`; `35:40`; service design invariant 2).
  - It blocks: a native item ever becoming `ready`, Start, `validate` (`NATIVE_FILE_REFERENCE_REQUIRED`) and `publish`.
  - It cannot be cleared on this machine: a reference needs a real qualified output and a policy needs real evidence IDs and a real cell key.
  - Adding any production row is an owner gate (service design header).

### Independent work these blockers do not prevent
- All of C1–C4 with injected policies and children, including AMF's refusal paths, fixed refusal texts and the startup brand assertion.
- AMF typed settings and descriptions, plus the hardware qualification procedure document.
- All QSV software (P02) and all CPU/NVIDIA SDR Q work (§6).

### Recommended status label
**PARTIAL — software incomplete (C1–C4 outstanding); AMF file execution specifically unavailable (B-AMF-PRODUCER, owner disposition pending; no AMD hardware; no qualified policy).**

After C1–C4 and C7 land: **PARTIAL — externally blocked; software complete for the finite H.264 8-bit route only.** That second label assumes D3 accepts the finite envelope.

---

## 4. P02 — Intel Quick Sync

**Requirement (tracker 25, verbatim):** "Useful QSV H264/HEVC/AV1 native ICQ/CQP adapters, actual RC verification and no substitution"

### Software implemented (evidence)
- **Adapters and device.** Pure QSV H264/HEVC/AV1 ICQ/CQP adapters with distinct scales and depth rules. The device is explicitly derived (`25:75`).
- **Initializer and effective-mode receipt.** A main-only zero-frame initializer and same-child effective-mode receipt plumbing exist. `NativeObservationCollector` binds plan, source hash, invocation, executed args and the closed child, then rejects any substituted mode, preset or quality (dependency-disposition `:50`). Vendor 60/60 plus independent review cover complete logs, stale/cancel/release checks and exact effective settings.
- **The file job's own receipt.** The runtime's `encode` builds the file job's own same-child effective observation from its own encoder child, with fresh before/after discovery (`native-file-runtime.cjs:121-135`). It never reuses the probe's receipt, as dependency-disposition `:52` requires. The selection is rechecked at every runtime step (`#selectionCurrent`, `:62`).
- **File command and labels.** The file builder constructs exact QSV CQP/ICQ argv (`8ef7ad1`). The "Intel Quick Sync — Beta" label is visible (`ui/renderer.js:795`).

### Software still missing
1. **C1–C4** (§2), including `requireNativeStart`. It refreshes `requireVerified` at Start and leaves a refused Start with every item still `ready` (service design §3.4; dependency-disposition `:54`).
2. **Hardware qualification procedure** (`31:182`), as for P01.
3. **HEVC/AV1/10-bit file contracts**, as for P01 (scope question D3).

### External blockers and exactly what each blocks
- **B-QSV-HARDWARE** (dependency-disposition `:44`). There is no local Intel device. It blocks:
  - actual Intel initialization and encoding;
  - the requirement's "actual RC verification", meaning a same-child effective-mode proof taken from a real driver's output;
  - a `verified` QSV cell on a real device;
  - a real reference output;
  - the evidence IDs a policy row needs.

  The collector's parsing has been exercised only on synthetic logs.
- **No qualified reference or policy**: as for P01. For QSV it depends on B-QSV-HARDWARE.
- **L-IDENTITY-ASSURANCE** (dependency-disposition `:47`; service design §10.4) is a bounded limit, not a gate. An ordinal plus a descriptor plus complete DXGI/API logs before and after does not prove an atomic encoder LUID, the final session or a vendor-DLL identity. It must be disclosed and creates no new gate. A later policy that needs stronger identity would need its own producer.

### Independent work these blockers do not prevent
All of C1–C4, the hardware procedure, QSV refusal and stale/cancel tests, and all CPU/NVIDIA SDR Q work.

### Recommended status label
**PARTIAL — software incomplete (C1–C4 outstanding); actual RC verification unverified (B-QSV-HARDWARE; no qualified policy); identity assurance bounded and disclosed.**

After C1–C4 and C7 land: **PARTIAL — externally blocked**, with the same D3 caveat as P01.

---

## 5. P03 — capability cells

**Requirement (tracker 25, verbatim):** "Discovered/untested/verified/unavailable/stale capability cells keyed by exact binary/device/driver/RC/depth/transform"

### Software implemented (evidence)
- **The five states.** `STATES = ['discovered','untested','verified','unavailable','stale']` (`backend-capabilities.cjs:15`).
- **Stale invalidation** (`31:220-223`): `staleReason`, `DEVICE_CHANGED` and `CAPABILITY_STALE` (`backend-capabilities.cjs:104, 160-173, 214-215`).
- **The cell key.** It hashes both binary SHA-256 values, the device (stable adapter identity, ordinal, driver), profile, preset, mode (RC), bit depth, pipeline, transform, signal and container (`backend-adapters.cjs:221-247`).
- **Sample-level integration.** Settings, typed IPC, preload and generated-sample integration landed at `bb53c05`: 217 direct checks, plus one unavailable junction fixture.
- **Real startup on this machine (October 26, at `bb53c05`).** Startup, Settings and Refresh closed 56 tool children and 2 CIM queries. All six native profiles reported `MISSING_DEVICE`, and no qualifier or file grant appeared. An independent closure audit passed.
- **Receipt checks.** Forged, stale, mismatched and incomplete receipts are refused, and release or abort invalidates the cell (vendor 60/60).
- **File runtime.** The runtime binds `nativeCellKey` into the policy match (`native-file-runtime.cjs:102`).

### Software still missing
- **File-level use of cells (C3–C4).** This means the readiness projection with its fixed reason order (service design §3.1, including `NATIVE_DISCOVERY_UNOBSERVED` and `NATIVE_CAPABILITY_UNVERIFIED`), `requireFileSelection` before `ready` and at Start, and the guards that stop selection changes while a native plan is ready (§3.5).
- **The native file evidence lifecycle in the service.** This comes from the same C1–C4 work.
- **Showing file-readiness reasons in the renderer.** This is C6, deferred by the owner scope gate (§7, D2). Requirement P03's state display is already met at sample level.

### External blockers and exactly what each blocks
- **No local AMD or Intel hardware.** No cell can reach `verified` from a real device here. Only `discovered`/`unavailable` (`MISSING_DEVICE`) states are observable locally, and `verified` appears only with injected fixtures.
- **B-AMF-PRODUCER.** AMF cells cannot reach `verified` on any hardware until it is resolved.

### Independent work these blockers do not prevent
C3–C4 readiness and staleness tests with injected cells, plus the D2 decision.

### Recommended status label
**PARTIAL — sample-cell software integrated and audited; file-lifecycle cell use pending (C3–C4); `verified` state unobservable without vendor hardware.**

After C1–C4 and C7 land: **PARTIAL — externally blocked.**

---

## 6. P04 — ordinary CPU/NVIDIA compatibility

**Requirement (tracker 25, verbatim):** "Unchanged ordinary CPU/NVIDIA Full/KeepSource SDR args/defaults and ArchiveCQ29"

### Software implemented (evidence)
- **Argv tests.** `tests/encode-operation.test.cjs:64`: "every ordinary profile and Archive CQ29 retain byte-for-byte accepted builder argv". Recipe guards are in `tests/recipe.test.cjs:11, 33`. Archive CQ29 is in `src/media.cjs:69-70` (p7, quality 29).
- **Separate native builders.** The native file command and runtime are separate modules with their own builder and validator. They touch no ordinary branch (68 separate compatibility passes at `8ef7ad1`).
- **Committed bytes.** The suite in `20261029T235425Z_full-suite-native-checkpoint` passes the ordinary suites at the committed `253c567` bytes.
- **Real startup.** At `bb53c05` all six CPU/NVIDIA profiles reported 8/10-bit availability through their short generated samples (`25:77`).

### Software still missing
- **NS-18 (C2).** With `nativeFiles` composed, the ordinary suites must pass unchanged and ordinary argv must be deep-equal with and without native composition.
- **The P04 recheck against the C1–C4 bytes (service design C7).** C2–C4 edit `src/encoder-service.cjs` and `main.js` through the §9 seams, so the `253c567` result does not carry over to those bytes.

### External blockers
None. P04 needs no vendor hardware.

### Cross-feature limits
- The tracker states that the current evidence "is not source-file or final cross-feature acceptance" (`25:77`). Final cross-feature acceptance belongs to Slice 6, the local cross-feature matrix (`31:184, 31:223`), which runs in the S phase.
- The suspended Encode-preservation (Full 7/32) and HDR (12/69) producer catalogs remain unresealed. The service design confirms that its seams do not newly expire an active seal. Any reseal needs its own owner approval, and the HDR reseal is out of scope (`35:18`).

### Recommended status label
**PARTIAL — compatibility contract verified at `253c567`; recheck owed at the C1–C4 bytes; cross-feature acceptance owed at Slice 6 / S. Not blocked.**

---

## 7. Can Q start?

### The rule, verbatim
- Amendment 33:18: "Begin the next dependency only after its required upstream software is complete or an exact material blocker and the independent work it does not prevent are documented. This does not silently close a blocked P criterion."
- Record 35:41: "When P01–P04 software is complete or exactly blocked, document the blocker and the independent work it does not prevent (amendment33 rule), then proceed to eligible Q."
- Record 35:18: "Non-HDR order: finish P01–P04 software, then eligible Q".

### Applying it

| Test | P01–P03 | P04 | Result |
|---|---|---|---|
| (a) Required upstream software complete? | **No.** Obligation 7 (C1–C4), R1–R4 and the pure admission check and controls are missing and implementable now. | **Yes** at the `253c567` bytes. Recheck owed at C1–C4. | (a) fails for the P block. |
| (b) Exact material blocker plus independent work documented? | **Yes** for B-AMF-PRODUCER, B-QSV-HARDWARE, AMD hardware absence and the missing qualified reference or policy (`33:43`; dependency-disposition `:44-48, :56-69`; this record). **No** for B-NATIVE-FILE-SW, because "Missing hardware is not a valid disposition for missing code" (dependency-disposition `:46`; `33:17`). | Not applicable: nothing is blocked. | (b) holds only for the external part. |

**Answer: not yet, as the next scheduled phase.** Under record 35:41 the condition applies to the P01–P04 block as a whole. P01–P03 have remaining software, C1–C4, that is neither complete nor externally blocked. Q becomes eligible when all three of these are true:
1. C1–C4 are committed, with `/evidence-run` receipts, `/security-review` and an independent reviewer pass.
2. The P04 recheck (NS-18) passes against those bytes.
3. The C7 closure record names B-AMF-PRODUCER, B-QSV-HARDWARE (plus AMD hardware absence), the missing qualified reference or policy, and L-IDENTITY-ASSURANCE as the remaining external limits, with production policies still `[]`.

At that point every remaining P01–P03 item is an exact external blocker, so (b) holds. P04 software satisfies (a), with acceptance deferred to S by the plan. Per `33:18`, none of this closes P01–P03.

**Q work already permitted before then.** Amendment 33:43 documented one exception: the bounded CPU/container Q07/Q08 cadence correction, which "cannot close P or Q". It was done at source `3fa87a3`. Laboratory packet `63e04e96` remains FAILED on a harness role cap, and `047d714f` completed only the ReadyCancel/staleStart check. That exception grants no new media or desktop campaign and covers no other Q work.

**A reading to disclose.** The October 26 dependency-disposition (`:7, :69`) reads `33:18` per dependency: CPU/NVIDIA Q's only upstream is P04, so it could begin. That was a reviewer recommendation made at `bb53c05`. Record 35, the later owner authority, frames the condition at block level, and this assessment follows record 35. Starting Q before C1–C4 would be an ordering decision for Ahmed (§8, D4).

**Practical reason for the order, as well as the rule.** C2–C4 and Q01–Q05 both edit `src/encoder-service.cjs`, and Q01–Q05 also change the ordinary operation code (`encode-operation.cjs`, `operation-family.cjs`, `operation-contract.cjs`; dependency-disposition `:67`).
- P04's NS-18 must prove that the native seams leave ordinary argv unchanged.
- That check is clean only if it runs before Q intentionally broadens ordinary geometry, range and audio behaviour.
- Doing C1–C4 first also keeps the two diffs apart in the shared file.

### Q work independent of the native blockers (eligible once the gate opens, in this order)
Source: dependency-disposition `:56-66`. All of it uses ordinary CPU/NVIDIA/Remux owners and exact measured policies, never native or HDR evidence, and widens no tolerance to turn a failure green (`33:18`).

1. **Q01, first:** exact SDR geometry and applicability for 2160/1440/1080/720, portrait/orthogonal orientation and non-square SAR/DAR. No upscale, crop, stretch, FPS change or deinterlace, and KeepSource stays unchanged. The current family admits only square 16:9 H.264 1080/720 and KeepSource/1080→720.
2. **Q02:** Full initial state, a single per-file range, exact fields and handles, explicit batch apply, and immutable edit/preparation behaviour.
3. **Q03/Q05:** first investigate the retained SVT duration failure. Then exact decoded boundaries, origins, delay and padding, and wider rate/layout/VFR/nonzero/late/multitrack contracts.
4. **Q04:** a separate explicit packet-copy override contract with requested/effective boundaries. Ordinary Full compatible copy is preserved.
5. **Q06:** pure rational math for chapter intersection and rebasing, plus a codec-scoped subtitle overlap/canvas policy. Unknown subtitle states stay refused.
6. **Q07/Q08:** MOV/TS/program/stream-relationship applicability and preservation validation through the existing Remux owner. The three finite routes are kept, and the failed VFR MKV→MP4, AAC-tail and PCM-layout records are preserved.

Actual media runs for these need the existing media lease and a resource window. Personal media is read-only test material and outputs go to project-owned folders (`35:12`).

### Q work that the native blockers do prevent
Any native-route part of a Q criterion stays blocked by the native blockers and the finite contract (range `null`, resolution `source`, video-only, 720p). This covers native geometry/profile qualification beyond the finite envelope, the "native qualification pending" note in Q01's tracker status, and native range, timing or audio.

---

## 8. Owner decisions needed (Ahmed)

| # | Decision | Why it is needed | Recommendation |
|---|---|---|---|
| D1 | **AMF same-component producer: technical disposition** | Owner gate (`35:23`). AMF stays specifically unavailable until a genuine producer exists or a reviewed disposition is accepted (`33:17`; dependency-disposition `:45, :54`). Any producer mechanism that needs an install, helper, instrumentation, dependency or runtime change is not authorized (`35:21`; dependency-disposition `:54`). | Record the disposition "AMF file encoding specifically unavailable in 0.7, Beta label kept, refusal text explains a missing producer", unless Ahmed wants a producer investigation under separate authority. |
| D2 | **C5–C6 scope** (renderer channel `encoder:prepare-native` and the native file UI) | Service design §12 defers them. Under `[]` they can only refuse and they add trust surface. | Do not schedule them while production policies are `[]`. |
| D3 | **Native file contract breadth for P01/P02** | The requirements name H264/HEVC/AV1 and per-depth support. The file route is finite: H.264 8-bit 720p Full/KeepSource Matroska, video only. Building HEVC/AV1/10-bit contracts is possible with injected tests but cannot be qualified locally. | Accept the finite H.264 route for P software closure, with HEVC/AV1/10-bit file requests specifically refused (`NATIVE_FILE_REQUEST_UNSUPPORTED`) and disclosed. Sample cells already cover all three codecs. |
| D4 | **Q start order** | Record 35:41 (block level) and dependency-disposition `:69` (per dependency) read `33:18` differently (§7). | Keep record 35's order: C1–C4, P04 recheck and C7 first, then Q01. |
| D5 | **Vendor qualification route** | P01–P03 can never pass `23:98` on this machine. A production policy or reference row needs genuine evidence, independent review and owner approval (`35:40`; service design header). | Decide whether an Intel (and later AMD) machine will be provided for a prospectively budgeted campaign, or whether 0.7 ships with "real vendor execution unverified" disclosed and Beta labels kept. |
| D6 | **Final P01–P03 labels at milestone acceptance** | Milestone and product acceptance are reserved to Ahmed (`35:23`). | Decide at S: accept or reject "PARTIAL — externally blocked" for these rows in 0.7. |
| D7 | **Encode-preservation (Full 7/32) catalog reseal** (later, before the S cross-feature matrix) | The catalog pins `main.js` and `encoder-service.cjs` and is already suspended. Reactivating it needs owner approval. The HDR reseal stays out of scope. | Raise this at S; no action now. |

L-IDENTITY-ASSURANCE needs no decision, only disclosure.

---

## 9. Limits of this assessment

- All of this is static reading of the committed sources, records and receipts at HEAD `9a2d27e`.
- No test was rerun, and no claim here applies to bytes other than those named in the cited receipts.
- No hardware, media, GUI, Notion or Git-writing action occurred.
- Tracker 25 texts and order are untouched. The C7 phase updates its evidence notes.
- HDR P05–P09 stays deferred and packaging stays last.
