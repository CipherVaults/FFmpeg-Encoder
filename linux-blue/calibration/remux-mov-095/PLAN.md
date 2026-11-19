# UNBOUND first private MP4→MOV cell

Source094 dfdc9d82ec841dbaf5263d2c41e1236400065b5b,1024 tracked files. BINDING.json records exact source hashes and existing fixture/runtime references but status is UNBOUND_NOT_RELEASED, ownerRoot/gatePath null, released false. No gate, owner or attempt marker exists. No media execution, product activation or publication. Only after separate immutable bound-copy review, preservation verification and explicit lead release may one attempt run. No automatic retry or second cell.

## Reuse and target-specific change

Literal derivative of the independently reviewed/actually executed first Matroska092 private runner. Original bytes/evidence unchanged. Collector points at frozen094; shared remux contract/evidence/validator/MOV-representation/edit-list files verified identical093→094. Runtime adapter and ownership helper unchanged. Scope/target/output extension change to MOV, explicit CFR30 check, genuine collector-owned MOV receipt passed to media validation, plus monotonic progress check during collector I/O. Runtime identity remains dfbae18…; no production catalog/runtime relabel.

One existing8s fixture only:5,578,679bytes SHA bc1edc43c90b14690d1a2a89986d4141b2719058a04e5901e4d6b3fdcd536d97. Historical metadata retained only for inert tests/expected geometry; actual run must rehash and inspect it. No new generation. Full H264/AAC48k stereo copy, no omissions/chapters, <=1080p CFR30. No seek/filter/reencode/alignment. The31s fixture is not in this execution scope; later decision only after first audit. Fixture identity binds this experiment, not future product admission.

## Source-derived ledger, not automatic MKV allowance

1 inspectMetadata source +1 packet-copy +1 output inspectMetadata +2 independent complete f32le PCM streams. No inspectInput duration-driven windows.

Current `src/remux-evidence.cjs` packet-identity branch has at most14 collector children:2 all-packet listings, up to4 codec-extradata queries (actual extradata cache can reduce to2),2 H264 complete-parameter passes,2 AAC initial admission probes,2 bounded H264 key-window invocations,2 complete native PCM passes. Thus19 maximum total requested invocations, serial1, commonly17 actual if extradata cache shares two. Unexpected calls refuse before spawn; no budget expansion. Boundary windows can reference the same keyframe and do not prove the final frame or full decoded video interior.

Unlike MKV, MOV additionally performs **native output edit-list parsing and MOV track-language representation plus a full output reseal**. Source read shows these are retained-handle filesystem operations, not subprocesses: `remux-evidence.cjs:1822–1840`, `mov-representation.cjs`. MOV representation metadata is bounded at8MiB,2048atoms/depth4/64tracks; artifact must bind actual track IDs and complete output hash. These extra I/O operations need time/read accounting despite adding zero children. Expected logical complete output seals are2×output size, not one; physical I/O remains unmeasured. No new output copy is created by resealing.

Actual inert assessment of this saved8s source derives collector limits:120000ms, maxSourceBytes5578679, maxOutputBytes26310565, maxFrameBytes8388608, maxPcmBytes134217728, maxRecords20000, maxTextBytes40960000,maxDurationSeconds10. The adapter explicitly narrows spool to16MiB, unchanged from reviewed first harness. Whole attempt600s, each child120s clipped to remaining time,27GiB free floor,512MiB sampled owned-tree cap. Independent PCM has64MiB stream cap per side (expected3,072,000 bytes each at384000 stereo float samples). These are refusal ceilings, not runtime/storage guarantees; no automatic adjustment if MOV's real evidence does not fit.

## Acceptance and failure boundaries

Require original complete compressed packet/header/metadata/timeline and priming/skip/discard checks, genuine main-owned MOV representation receipt, shared media-only validator success, independent full PCM byte count/hash equality from sample zero, unchanged source/fixture/runtime, all actual children closed and normal runtime close. Existing rational2ms media timestamp ceiling remains unchanged; it is not permission to waive21ms AAC priming or shift any PCM. MOV native edit-list/representation requirements remain strict. No exact binary-determinism or player-compatibility claim.

Monotonic deadline checked at invocation, collector progress, independent PCM boundaries, final currentness/hash validation and before/after acceptance persistence. Owner checks preserve canonical ordinary ancestors/currentUID and retained directory identities; input reads use no-follow retained handles. Failure report is written under owner identity even after acceptance deadline fails, then post-write deadline refusal forces outer nonzero; report text alone cannot authorize success. Require final acceptance record AND observed outer exit0 AND independent saved audit. Shared runtime ownership remains authority; not a malicious-sameUID sandbox claim.

No service lifecycle, UI, cancellation overlap, provenance reopen or public distribution is established by a media-only result. Actual MOV lifecycle and reviewed target-owned product admission would be separate. Ubuntu manufacture remains higher priority when actionable.
