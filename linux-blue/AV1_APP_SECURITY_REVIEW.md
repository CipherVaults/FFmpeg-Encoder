# AV1 integration: bounded shift-left security review

This is a manual, source-scoped security review, not an automated scan, whole-
repository audit or certification. The security-diff workflow was consulted;
its referenced preflight resource/helper was unavailable on this host. No scan ID
or completed formal-scan artifact is claimed. No production activation follows.

## Exact reviewed scope

Admission and ordinary-guard source/test bytes are from local `d196e259`.
The additional controls builder was reviewed before its pending Full-service pin
or application wiring changed. SHA256:

- `workbench-av1-admission.cjs`: `1b09ad23827845b87219325c54ca3252fc2b9d4a683c72d8e4deb2e52d1b62f6`
- `workbench-av1-admission.test.cjs`: `412772aeee9086cbb6fee95df402b3bf2150783ce49a1e37d27eb151f348d9e9`
- `workbench-service.cjs`: `1f8ef2673fb3e0ea6d4cdbd8d7e726fee72d94dd9d54120d9cd7e9877fb52c80`
- `workbench-qualified-encode-controls.cjs`: `c1c78c74ab67d205d5e77f85ca4cbd8815f6587421d26532e8efc45c74fc5264`
- `workbench-qualified-encode-controls.test.cjs`: `03cffaff9db0ea28539f1294ee130523d2bd7b224ab69cfa5b0180013a21dcd7`

## Threat model and controls checked

Renderer requests, source/probe metadata and child output are untrusted. Main
owns catalogs, runtime paths, exact receipt hashes, private selection/observer
tokens, source identities, process budgets and publication. Review followed the
new behavior into existing supporting code, without treating the whole repository
as reviewed:

- IPC sender/frame/URL and arity checks; native folder selection instead of
  renderer filesystem authority. No new IPC, shell or external-data export route.
- All selected entries preflight before state mutation; malformed/stale selection
  refusal remains in the shared service. Private token methods bind the actual
  plan/source/settings/runtime/budget rather than renderer-supplied snapshots.
- Fixed immutable proof hashes and first pending-Full gate before receipt reads.
  Pure schema-test digest overrides cannot construct controls or replace pins.
- Fixed executable pairs, dense inert arguments, `shell:false`, positive bounded
  process/output budgets, cancellation ownership and child/sink settlement.
- Prepublication source/folder/qualification/runtime rechecks; no-overwrite link
  or exclusive-copy behavior and retained uncertainty instead of overwriting.
- Existing renderer text handling for reasons/arguments and local-only diagnostic
  behavior; no new sensitive-data transmission.

Independent review found no concrete reachable new vulnerability in that scope.
Rejected hypotheses included forged IPC callbacks/main receipt overrides and a
mixed valid/invalid batch partially starting. The 39 admission/baseline/runtime
and 33 controls/composition checks are supporting evidence, not a substitute for
security reasoning or composed-service execution.

## Remaining gates

The ordinary runner is composition-owned, so future factory wiring must explicitly
preserve the fixed pair and ordinary runner. Async runtime checks remain mandatory;
a token snapshot alone is not a fresh binary check. Full service evidence must
be independently accepted before pinning controls. New wiring/pins require focused
review and genuine composed-service tests before application acceptance.

No parser fuzzing, live IPC/native journey, adversarial filesystem race experiment
or exhaustive dependency review was performed. Existing filesystem uncertainty
and native media-parser risks are not eliminated by this seam. Raw diagnostics
may retain owned paths/stderr locally under existing behavior. Baseline native
proof and the newer-runtime socket limitation remain separate.

## Accepted Full proof pin and construction review

The original hashes above remain the historical pre-pin review scope. The new
Full service receipt was independently hashed as
`77e03609a3806ce1f3d7d8041791ae82f07043f3c9dcd0b5ebe854742da49a9b`
and pinned at `full-resize-service-pgkknH/report.json`. Current controls bytes:

- `workbench-qualified-encode-controls.cjs`: `3bc2c436c54f152dba6fb0129a7d23145333600fec00079d0292076c2195a221`
- `workbench-qualified-encode-controls.test.cjs`: `73b63a3ad71fad5f2a49a8494795fec91178e1225f035fbc39d30065171c2e2d`

Focused source review confirmed that the new factory calls the real controls
builder before construction, retains `createAv1Runner` as the ordinary runner,
and supplies the proportional runner only to the qualified runtime observer.
No invocation heuristic, fallback, renderer configuration or main-route switch
was added. Full service evidence is now accepted; composed execution and native
acceptance remain outstanding gates.

All 17 focused controls/factory/harness/admission tests passed. They include all
three exact service receipts, enduring pending-Full refusal before reads using a
test-only dependency fixture, and positive construction of the real qualified
factory with exact runtime/dependency verification. That construction started no
capability or media child, did not open evidence storage, and closed its runtime
resources. It proves construction/status propagation, not composed execution,
publication or a native UI journey. No new formal security-scan claim is made.


## Composed service and explicit entry wiring

The fresh composed-service receipt `qualified-app-service-j5kQ15` passed 17 cases
at SHA256 `a422fffa11aaed193ff0e7624fd06d8df76103c3f1d861cb2fb5bce671b23728`.
Independent terminal review verified all 28 frozen source identities, 218/218 closed
children, no live children and the genuine mixed/forged/stale/cancel/collision
outcomes. The original MOV channel-layout-loss conversion remains an explicit
must-refuse case; no output-preservation guard was weakened.

After that review, the main entry's existing startup-only AV1 option selects the
qualified factory. Baseline selection remains lazy and unchanged. Only the title,
readiness mode/family disclosure and factory selector changed in main; original
IPC/preload/UI, sandbox, navigation/network/permission restrictions and admission/
resource/diagnostic closure hooks remain. The factory and admission bodies changed
only their now-stale comments after media proof. Updated focused checks passed
52/52. This is not a live IPC/native test, automated scan or security certificate.

Final focused wiring identities (SHA256):
- `workbench-main.cjs`: `edeb58f7995245ccc55ae3a2f36c1991977d998dff376e3cf56cd02ec2f0bf87`
- `workbench-av1-service.cjs`: `001c196f959fbf6fef233ba46d0cd82ee09c5e4d88986047c9d5618b8d8bccf2`
- `workbench-av1-admission.cjs`: `20899a813ef101b0c7b7d25a14c4653b5fce3a0d71baa749c66be840752cf7e7`
- `workbench-av1-service.test.cjs`: `5b430cc610dd6e3c4d16a26084e3eb38e9cc494ae054d8d49c571ad30a1787bb`
- `workbench-qualified-encode-controls.test.cjs`: `c885c4ce00556c108118d13324c2c369748d22d047a8517cbfb5e32b420f97f3`


## Four-family 1440p extension and dependency isolation

The bounded independent diff review caught and corrected an eager fourth-service
import that could break the preserved three-family route. The fourth module now
loads only on the four-family builder path; a throwing-dependency regression
proves old construction remains independent while new construction fails closed.
Exact receipt pins, before-read pending gates, private current selector authority,
fixed pair, ordinary/proportional runner separation and whole-batch preflight
remain. No renderer API, arbitrary path/argument channel or network export was added.

Independent terminal review accepted the 18-case composed receipt
`1b48c726c8c5de0923c9c1533ee0ec4a5907e411c3109c90d8c4fe0d534b7d1e`,
all 34 frozen source identities and six media hashes, 236/236 closed children,
forged/stale zero-child refusal, active cancellations and collision protection.
Main then changed only its explicit AV1 selector to the four-family factory;
59/59 wiring checks passed. Factory/controls executable bodies did not change
after media proof. The previous native, filesystem-race, parser and full-repository
review limitations still apply. This is not an automated security scan.

Final focused wiring identities (SHA256):
- `workbench-main.cjs`: `0c2cc197e9d2f737cf04b3f15879410554bc40222c5822ba79043a02ae7f3bb5`
- `workbench-av1-service.cjs`: `3e3194ad1192add569d93f230d2891dc339c6215b7ee5095a2f9523950679db9`
- `workbench-av1-admission.cjs`: `0922c276755c7791cbcaa314b95990bba8634e8dc33302ee23baadb2b0c0dc53`
- `workbench-qualified-encode-controls.cjs`: `9b4e3af77a0ffc9125ec61eb39d6383b7666bccbb3cdd69ad4a02f12ff89d9c7`
- `workbench-av1-service.test.cjs`: `6079eec204ed3e0b15970089018a06ac42e0072b1fc06b67d8192d35349036a6`
- `workbench-qualified-encode-controls.test.cjs`: `18b69949fa9f5894556a74e11e8b0c7a2625022df397ab9388515730fe874ac1`
