# Windows shutdown and expanded CI safety

## Status and scope
This record closes at 16:16:28.067800 UTC on 18 November 2026 and records the reviewed four-file integration and completed local lead tests. The fixed path record specifies eight changed paths and an expected 690 files: four existing source/documentation files plus Current, Session and two new owning records. No portable runtime evidence package is needed.

The source slice changes `main.js`, `tests/main-lifecycle.test.cjs`, `scripts/ci-source-contracts.cjs` and `linux-blue/CI_SOURCE_CONTRACTS.md`. It does not change workflow YAML, pinned actions, Node version, token permissions, Linux defaults, audio policy or capsule pins. Session is maintained by its separate writer.

## Defect, review and accepted correction
The first shutdown proposal could strand an already-fenced window when the initially confirmed busy cancellation rejected. Resource closure and terminal diagnostics would not run. V2 preserves Keep as uncommitted and unfenced. Cancel fences before cancellation, immediately observes and retains that promise, and checks its failure identity at terminal closure even if a later cancellation succeeds. A destroyed parent is not closed twice.

Ordinary close, renderer loss and startup fence synchronously when ownership commits. Unregistering retires new IPC calls but does not discard accepted work. Child work is asked to stop before waiting for accepted IPC; resources then close, settings flush and one terminal diagnostic is attempted after settlement. Persisted failed-session outcomes, ordinary quit and incomplete-diagnostic status remain distinct. A service rejection is not a diagnostic rejection unless the diagnostic promise rejects; a fulfilled `persisted:false` value is not itself rejection. No claim is made that every produced diagnostic was saved. A never-settling owned promise can still leave shutdown waiting; this patch adds neither forced settlement nor a timeout/force-exit guarantee.

Independent controls retained the original 31/31 lifecycle baseline and old main with final tests at 29/36, including seven named failures. V1 separately failed the held-call plus rejected-busy-cancel control. V2 passed 60 lifecycle/shared-IPC/Linux-quit tests and three additional reviewer probes for rejected initial cancellation, multiple accepted calls with rejected reporting, and production OutputAccess accounting through injected dispatch and a pending incident receipt. These overlap with lead tests and are not independent evidence of native desktop behavior.

## Expanded shared CI selection
The runner appends four complete files: main lifecycle, process runner, completed-output retention and output access. There are no test-name filters, skips or platform exceptions. Private filesystem fixtures exercise actual hard links and races; shell callbacks are injected. Windows UNC/device/drive-relative refusal assertions are retained. Process tests use injected children and two real bounded owned Node helper processes, not FFmpeg or Electron launches.

The independent CI review passed 113 added-suite cases and the final local runner's 202 syntax checks, 209 shared tests and 10 Linux UI-policy tests. Its old-main negative control failed seven lifecycle labels (202 passed, seven failed), exited 1, omitted the final PASS banner and did not run the Linux step. This establishes exit-status propagation, not native Windows or hosted expanded-lane acceptance. Previous narrower hosted CI results are not silently carried forward to the expanded lane.

## Integration and actual lead tests
Integration at 16:13:49.426955 UTC used exact reviewed hashes on base `874a6938134ef8bc06727077259f103e71101bdf`. It followed both 056 source and full-history restoration gates. The remaining 684 prior files were unchanged. The exact saved cutoff snapshot also supports completed native Session, plan and owning-record preservation. The initial cutoff note incorrectly called native preservation pending because the lead had not processed its release message. Immediate snapshot inspection corrected that attribution without changing the cutoff or any source/runtime/publication action. GitHub and final mapping remained later; this record does not bind the mutable final receipt.

Lead tests ran with Node v24.22.1 on Linux, finishing at 16:14:11.454944 UTC. Raw child exit codes were saved before parsing:
- CI runner: exit 0, 202 syntax checks, 209/209 shared and 10/10 Linux.
- Focused lifecycle, IPC and Linux quit: exit 0, 60/60.
- Wider selection: exit 1, 218/220, the same two baseline positive-assumption failures.
- Protection: exit 0, 229/229.

All selections had zero skipped or cancelled tests; their coverage overlaps and is not added into one total. All 688 checked source files remained byte-identical during testing. Commands, selected file hashes, output identities and exact failed labels are retained in the curated receipt and its referenced lead result. No blanket all-tests-green claim is made.

## Producer closure and limits
The actual producer check matches the baseline contracts: E3 97/97 and Full-copy 26/26 identities are exact with no edited-path intersections. Historical HDR has 36 mismatches among 69 identities, and encode-preservation has 16 among 32. Their registries and empty policy lists remain unchanged; `main.js` is already stale in those historical sets. The two wider positive-assumption failures remain visible. No reseal, new qualification or downstream success is inferred from them.

There was no native Windows desktop, picker/shell, descendant-process-tree, GPU/RTX, package, FFmpeg/media or owner-acceptance run for this slice. Source/VM and filesystem/Node-helper coverage is useful but narrower. No performance benchmark or accepted release/default was changed. Checkpoint 057 preservation and matched hosted expanded-lane verification remain next steps; no later outcome is imported.
