# Private current-runtime MP4 → Matroska proof proposal

Preparation only. Canonical 091 (55256a431b5021b84485ab8f8f120b5aa66f665c, 973 source files) remains unchanged. No media command, product admission, package or publication is authorized by this proposal. Bind a fresh owner/gate and obtain independent review plus lead release before one attempt. No automatic retry or second timing case.

## Exact first input and objective

Reuse the existing eight-second MP4 H264/AAC fixture pinned in BINDING.json: 5,578,679 bytes, SHA256 bc1edc43c90b14690d1a2a89986d4141b2719058a04e5901e4d6b3fdcd536d97. It has 240 video packets and 376 AAC packets in the independently retained prior same-container proof; those are historical expectations, not substituted fresh observations. Fresh metadata, collector and unchanged-file readback remain required. Do not generate a new fixture, silently discard audio, re-encode, shift PCM, subtract guessed priming or grant a 21 ms waiver.

One genuine shared assessRemux/buildRemuxQualificationArgs operation targets Matroska, writes an exclusive private copy.mkv, then runs shared packet-identity-v1 evidence and media-only validation. Existing runtime pair/dependencies remain separately pinned. The old shipping policy's different runtime is NOT promoted or relabeled; this private proof grants no execution-ready catalog authority.

## Actual source-derived process ledger

The metadata inspector here is inspectMetadata, not inspectInput/finishInspection: one source probe and one output probe, no duration-driven inspection windows. One packet-copy child. Two separate full decoded stereo f32le presentation passes stream hash/count from sample zero, with no filters, seeks, trim or alignment shift. These are a diagnostic cross-check in addition to the collector's own complete native PCM proof.

Collector maximum14 serial children follows current src/remux-evidence.cjs: two all-packet listings; up to four unique codec-extradata fetches across two streams and two containers (cache uses actual size/hash); two complete H264 parameter scans; two initial AAC admission windows; two bounded H264 key-window invocations; two complete native PCM passes. Identical source/output extradata uses only two fetches, so expected collector12 and total17; a differing representation may need14 before independently passing or refusing. There is no extra child allowance beyond this explicit19 total. Key start/end can reference the same keyframe for this fixture and must not be described as final-frame/interior-video decode.

Each phase has a pre-spawn request ceiling, overall children19/serial1, child120s, whole600s, free floor27GiB, owned-tree512MiB sampled ceiling. Requested invocations and actual child close observations are distinct, especially on refused pre-spawn calls. Any unexpected collector call stops rather than silently increasing the allowance.

## Acceptance and retained failure

Require original packet/header/stream/metadata/timeline/priming/skip/discard validation, shared media validator validity, complete independent PCM count and hash equality, no live owned child, normal runtime closure, unchanged source/runtime inputs and authoritative monotonic deadline through final checks and report write. Matroska timestamp representation uses the existing 2 ms rational media validation ceiling, not an AAC-offset waiver; complete presentation must still be identical without shifts. Failures retain raw reports and the output but never publish or activate a route. FINAL_ACCEPTANCE plus successful outer exit are needed; an intermediate report alone is not completion authority. A deadline expiring during final persistence must fail the outer attempt, not turn into a pass.

Ownership uses canonical no-symlink ancestors/current UID and bound parent/root inode/device checks, O_NOFOLLOW retained-handle pin reads, exclusive fresh roots/markers/report writes. This is fail-closed ordinary filesystem verification, not a claim of atomic directory-handle sandboxing against a malicious same-UID concurrent writer. System runtime dependencies retain their existing own validation rather than pretending to be user-owned.

## Reuse and limitations

The private 075 remux acquisition runner/runtime/collector adapter is reused as a literal derivative, rebased to exact091 sources. Its historical proof is retained unchanged. Monotonic and owned-directory helpers are exact copies of the corrected independently reviewed AAC runner helpers. Only target, source binding, ledger, final checks and independent PCM diagnostic differ; no new generic infrastructure. Seven inert tests cover safety/control contracts. Original AAC delay history and failed runs are unchanged.

If this one conversion fails, inspect the exact representation transition before deciding any second timing cell. Do not change thresholds to force a pass. Even a pass needs independent saved audit, additional scope reasoning and separate product wiring/native acceptance. No release portability, all-player compatibility, cancellation lifecycle, GPU or owner-PC acceptance is established here.
