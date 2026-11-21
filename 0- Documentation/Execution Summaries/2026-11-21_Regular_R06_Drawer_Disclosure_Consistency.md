# Regular v0.7 R06: keep Files drawer disclosure consistent

November 21, 2026 Cairo. Shared UI source candidate; not native or milestone acceptance.

**Observed mismatch.** Checkpoint 131's independent review preserved an earlier edge: open the Files drawer on a narrow viewport, widen, explicitly collapse the desktop preview, then narrow again. The list stays hidden, but the trigger claims `aria-expanded=true` and the first press closes an already hidden list. The same mismatch occurs when a new 21-item ready preview auto-collapses while the narrow open preference is remembered.

**Behavior.** Narrow drawer expansion now depends on both the remembered drawer choice and the preview not being collapsed. The trigger's accessibility state, drawer class, hidden membership, breakpoint handoff, clicks and Escape share that effective state. Resize does not set preview visibility or overwrite the preference. One explicit narrow press opens the file list; a closed drawer does not consume Escape. Opening the desktop preview separately still restores the remembered narrow state when returning. No CSS, HTML, IPC, selected batch, media policy, jobs, CI or release behavior changed.

**Exact source.** Base checkpoint 131 original `c9df86c6214f015cf4f089c2df6c16804b2627cd`, tree `65a8d5e90cb0de1f2f086949070312321e7e4252`. Source patch SHA-256 `63b168cc1cc910c5f94122ee106593df9ba97d0a26b05a02d87d227476fae07a`, cold source tree `f732be75a859050a864df1e9f2c8294f0e3958f7` (not a commit). All 158 active and 188 inert source pins checked; only the active renderer tuple and its renderer/qualification inert rows changed. All 88 non-source definitions and inactive package flags unchanged; no binaries verified.

| Exact receipt | Result |
| --- | --- |
| `20261121T010315Z_r06-drawer-red-131` | Initial workbench red: 98 pass, three intended mismatches, no skips, exit 1. |
| `20261121T010500Z_r06-drawer-red-r02-131` | Cold baseline with final tests: same 98/3/0, exit 1; all three fail on expanded true for a hidden list. |
| `20261121T010432Z_r06-drawer-green-r01` | 242 passed, zero failures or skips, exit 0 across seven affected renderer/vendor/draft/EncoderService/Linux source suites. |
| `20261121T010502Z_r06-drawer-cold-r01` | Exact cold reconstruction and retest, same 242/0/0, exit 0. Counts overlap and are not summed. |

**Boundaries and next test.** Node 24.22.3 controlled DOM and source only. Test evidence covers Encode/Remux focus from Collapse and the active filter, 21-item auto-collapse, present/hidden class and expanded label, retained selection, and zero extra preload calls. No CSS compositor, actual resize/Tab, pixels, screen reader, DPI, media executable, owner PC, package, CI execution or release. Add the sequence to the first approved exact Electron focus test: confirm one open action and actual screen-reader/AX state with focus visible; separately capture minimum content versus outer dimensions, DPI and Cancel reachability. If integrating alongside Q source-pin changes, recompute the inert qualification digest from final merged bytes. R06 remains partial.

## Composition against Q132

Original Q132 `d3a450d448c3295d6dfd2368050d40a06e923098`, tree `45b106934fde238be5ac1e6a0994f5c9a22114af`. The 131-based independent review passed 277 affected checks, with additional controlled edge observations. The composed renderer and workbench test bytes match that reviewed candidate exactly. Q132's unified Linux service, its tests, its source-pin row and its PBS history are retained. The two active tuples relative to 131 are the reviewed renderer and the Q132 unified service; relative to 132 only the renderer changes. The inert qualification digest is recomputed from their combined registry: `6ce62c7f506c76226c6d52239771fa3ad6caa0781d788a44dee2e9a12d2d89f4`. All 158 active and 188 inert source pins verified, with 88 external rows unchanged and not exercised. Composed source before records: `f025dedac02a574e672439b1a69572570037b1fc`.

The integrated controlled source suite `20261121T010844Z_r06-drawer-combined-q132-r01` covers nine files including the unified Linux service and runtime: **400 passed, 0 failed, 1 skipped**, exit 0. The unavailable retained real 9.0.2 MKV probe is a pre-existing archive-dependent skip. This does not repeat or replace the previous independent receipt, native qualification, hosted CI or release tests.

The independent reviewer also reproduced a separate inherited condition: when Current Jobs physically owns the shared list, an editor trigger can still say expanded despite no editor list. This candidate intentionally leaves this follow-up intact. Neither the integrated result nor the one-press fix establishes native minimum size, DPI, assistive technology, or broader R06 closure.
