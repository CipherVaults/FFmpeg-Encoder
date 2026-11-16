# Linux synthetic desktop checkpoint

## 1. Outcome and authority

**A separate local Electron demo now drives the existing synthetic-only CPU
service through a narrow renderer boundary.** Ahmed authorized continued Linux
development with local Git rather than waiting for GitHub, and routine private
synchronization of independently permissible new work. This record applies to
the Linux experiment only. Blue is the integrator; Ahmed retains product and
release acceptance. AI PBS 1.1 and the adopted readable Git checkpoint workflow
guide this bounded step. No Windows integration or public release is authorized.

The visible desktop test encoded H.264, H.265 and AV1 at their unchanged CPU
defaults. Each reached validated no-overwrite publication. A repeated AV1
request preserved its existing output. A second session exercised rapid
Start → Cancel, then restart → window Close. Both desktop sessions exited zero
and closed all 24 owned children. **107/107 focused checks passed**, no skips
or failures. This is a tiny synthetic desktop demonstration, not a complete
Linux application or an accepted 0.7 release.

## 2. Goal, plan and finish line

User benefit: exercise useful Linux work through a real desktop instead of
leaving the CPU service behind a command-line-only proof.

The bounded plan was to add an opt-in main/preload/renderer composition with
three CPU choices, editable preset/quality, Start, Cancel and limited status.
Main owns the one known fixture, executable pins, output directory, job lifetime
and publication. The renderer gets no paths, commands, arbitrary process options,
raw error objects or filesystem API. One job may run at a time. Close must drain
the service before destroying the window. The existing service and Windows code
must remain unchanged. Finish at focused tests, independent review, native
desktop evidence and a recoverable Git checkpoint; do not expand into packaging,
arbitrary media, persistent recovery or hardware support.

## 3. Changes and design decisions

Eight new implementation/test files, with no edits to the existing baseline:

- `demo-controller.cjs`: synchronous admission closure, one active job, sanitized
  snapshots, cancellation drain and distinct publication/uncertainty outcomes.
- `demo-ipc.cjs`: exactly four methods; matching WebContents, top frame, exact
  entry URL and argument count required for every request. Errors are allowlisted.
- `demo-preload.cjs`: exposes only choices, state, start and cancel, never generic
  Electron IPC or its event object.
- `demo-main.cjs`: separate Electron entry, main-owned fixture/output paths,
  pinned-tool verification, sandbox/context isolation, no renderer Node, denied
  permissions/navigation/popups/webviews, local-resource-only session requests,
  main-only child census and drained normal shutdown.
- `demo.html`, `demo.css`, `demo-renderer.js`: a small explicit synthetic-only
  interface, external local script/style and restrictive CSP. Encoded-frame
  progress is not treated as validated success.
- `demo-boundary.test.cjs`: nine controller/IPC tests for positive admission,
  refusal, private-data boundaries, cancellation and close races, collision and
  published/uncertain failure receipts.

The local runtime adapter, CPU policy, synthetic service, production source,
Windows main/preload/runtime verifier, profile defaults, Archive CQ29, benchmark
and qualification catalogs were not changed. The existing service supplies
owned fixture capture, stage/seal/validate/atomic-publish and child execution.
No component was duplicated to avoid a publication restriction.

## 4. Source and environment identity

Local baseline: `d47c6f36d77af48a3166adf2e82a1e9ca0556654`, on
`blue/local-synthetic-demo` in the existing local-service checkout. This is
new local snapshot history, not imported Windows history and not the fork's
remote history. It preserves 546 source/assets/test/record files, including the
eight captured PC corrections, the Linux adapter and the reviewed local service.
No remote was configured for this complete local snapshot.

Environment: Linux x64; focused Node checks used Node 24.22.1. The actual native
desktop used the already-installed official Electron 44.7.0. Existing fixed
Debian FFmpeg/ffprobe 7.1.5 pins were verified by the unchanged runtime. No new
installation, credential, OS security change or sandbox-disabling flag was used.

Known source: the existing 172,442-byte synthetic fixture, SHA256
`145c63faaaa6052e7fd7b0dc206319c67355edbb8b5e2c43a2687af5100a5d06`.
It remained unchanged. Only that fixture is accepted; no personal media ran.

Final implementation SHA256 values:

| File | SHA256 |
| --- | --- |
| demo-controller.cjs | afca8582f6fdb1ab84f7b671664434ccda179488d79419432fbfbb19d8155d96 |
| demo-ipc.cjs | eccb956dba7b451145a144ba28819fdf8857246b464045934194b1f1a1481bcf |
| demo-main.cjs | c887f2bf0ced5e05c1ad4a556bde4cc7e6b045b95f7790b0ea979198a9f01ddc |
| demo-preload.cjs | 6fe4cf12295c3b407a6c0ebe71d79c12ec6ec611e33b18f232d60fb045f96041 |
| demo-renderer.js | 524db58d1e508086a58463c5e900a055ab296336c6dffe7537ca3dc9775a18eb |
| demo.html | 25d01db471155c8b1bffc5627790d350dbf3d3fa94513f2023d328258119f8de |
| demo.css | ea15235bda92c0b5dd0434603eb40120c209cd2fe241acd30ebcdb51f56f3aee |
| demo-boundary.test.cjs | 776274533169ba1e06aaf3be1db6b90b212b0d78b302504b2598e2abb1943dff |

## 5. Verification and actual use path

Focused final command:

```sh
node --test tests/media.test.cjs tests/container-clock.test.cjs tests/process-runner.test.cjs linux-blue/runtime.test.cjs linux-blue/ui-policy.test.cjs linux-blue/demo-boundary.test.cjs
```

Result: **107 passed, 0 failed, 0 skipped**. This combines the existing bounded
88-test portable/runtime set, ten policy tests and nine new boundary tests;
it is not a full `npm test`. Receipt: sibling `evidence/desktop-demo-final-tests.tap`.

The real demo was launched through the supported cloud desktop terminal. Native
mouse/keyboard controls selected and started all three codecs. This exercised
the actual renderer → preload → IPC → controller → existing synthetic service,
not a direct service substitute or injected renderer implementation.

- Session 2: default H264/slower/24, H265/slow/25 and AV1/6/32 each visibly reached
  “Validated output published.” The service checks stream shape, 12 frames,
  dimensions, color, PCM audio properties/payload, language/title and full decode
  before publication. A repeated AV1 request returned `SYNTHETIC_OUTPUT_EXISTS`;
  the prior AV1 hash remained unchanged. Normal Close: **18 spawned, 18 closed,
  max 1 live, 0 remaining**, desktop process exit 0.
- Session 3: rapid Start then Cancel visibly reached “Cancelled safely.” Starting
  again and immediately closing the window drained and exited 0. Across those
  two interrupted jobs: **6 spawned, 6 closed, max 1 live, 0 remaining**; no final
  `.mkv` outputs were published. This is early UI cancellation/close evidence,
  not an assertion that a particular encoded frame was reached.
- Both ready receipts read back actual Electron web preferences:
  `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true`.

Raw receipts: sibling `evidence/desktop-demo-attempt-2.txt` and `-3.txt`.
Generated outputs remain ignored under `linux-blue/artifacts/desktop-demo/`.
The successful session output SHA256 values are:

| Output | Bytes | SHA256 |
| --- | ---: | --- |
| h264-cpu.mkv | 90410 | d9c5c1aeb722443cc86f8044fd0182282110b193c7493e51a1fd6e4acbda8aee |
| h265-cpu.mkv | 95151 | 2b66cf56a06d3b486ae1479605c8591c47c6575c6565e370ad3adafb6ce74d9e |
| av1-cpu.mkv | 89628 | 2121c58d12c78fd63ac23d683c6bfdbe80ea358d82cbaca1b0762bd4c345733c |

## 6. Failures and review corrections retained

Independent source review caught that Electron `setPath` requires existing
directories. Both dedicated userData/sessionData directories are now created
before `setPath`, before app readiness. No security flag was weakened.

The first actual launch did not open a window: Electron's direct `.cjs` entry
did not make `require.main === module`, so the conditional launch never ran.
That attempt was manually interrupted before any media job; its original log
remains `desktop-demo-attempt-1.txt`. It is **not** a successful desktop result,
even though the interrupted process returned zero. The entry now launches
unconditionally; the recovery log explicitly observed `requireMainMatches:false`.

Review also required honest publication outcomes. A late cancel cannot overwrite
completed publication; cleanup errors after publication show a warning; uncertain
publication stays uncertain. Tests preserve those distinctions and never expose
raw receipt paths/errors to the renderer. Independent source review passed the
corrected narrow implementation. Independent final receipt review also matched
the final eight file hashes, 107-test receipt, 18/18 and 6/6 child closure,
three successful output sizes, no outputs in the interrupted session, unchanged
fixture hashes and unchanged pre-existing source. No media was rerun for review.

## 7. Limits and unresolved work

- Only this known 12-frame SDR fixture and this host/runtime are demonstrated.
  No arbitrary-media admission, general fidelity, persistent reuse/recovery,
  normal EncoderService parity, GPU, HDR, Windows, installer or release claim.
- Runtime library closure is not fully pinned. Actual Electron preferences and
  a functioning desktop are not OS sandbox attestation. D-Bus and SSL diagnostic
  warnings remain in raw logs; no whole-process/network-isolation claim is made.
- Renderer-crash handling exists, but crash injection was not performed. Sender
  and request refusals were tested at the handler boundary, not as an exhaustive
  adversarial Electron campaign. Closing during a published-output cleanup race
  is modeled in controller tests, not a newly generated real race campaign.
- Small UI follow-ups remain optional: retain transient request errors across
  polling and display a clearer disconnected state. Neither grants authority.

## 8. Git, publication and off-machine backup gap

Local Git protects the complete selected local code state. It does **not** make
that history an off-machine backup. Earlier publication restrictions remain
unresolved; the complete local history must not be pushed just because the new
UI files are permissible. This milestone never retries, rewrites or repackages
earlier denied/uncertain payloads.

Only these eight new files and this newly written record are candidates for
routine private synchronization to `CipherVaults/FFmpeg-Encoder-Blue-Linux`,
`blue/linux-development`, after reviewing exact content and the current branch
tip. A successful upload alone is not publication; the branch/ref and exact
file hashes must be read back. The final local/remote SHAs belong in the handoff,
not invented inside a commit before it exists.

**The private fork still lacks the earlier `linux-blue/runtime.cjs` dependency
and the synthetic fixture. Publishing this new UI does not make the remote
checkout runnable.** Its referenced existing source files do not authorize
transferring unresolved material. Raw desktop logs, generated media, local
Electron binaries/state and the complete local Git history remain local-only.
The pre-existing Library intake protects the captured source, not all later
Linux work or this new runtime-dependent desktop composition.

## 9. Reproduction and continuation

From a complete local-service checkout in a GUI-capable environment, using the
already-installed reviewed Electron and the existing exact fixture:

```sh
LINUX_BLUE_SYNTHETIC_FIXTURE=/absolute/path/to/known/synthetic-source.mkv \
  /path/to/reviewed/electron linux-blue/demo-main.cjs
```

Do not use `npm start`: it intentionally remains the Windows launcher. Do not
disable sandboxing or generate new pins merely to make another host work.

Next useful boundary: review a broader source-admission/storage contract before
adding file picking or arbitrary-media execution. The current interface must
remain synthetic-only until that contract is implemented and tested. Separately,
resolve the runtime's publication status through the supported review process
to close the remote runnable-dependency gap. Do not replay this demo solely to
refresh timestamps or treat this checkpoint as acceptance of all Linux work.
