# Regular v0.7 R06: focus recovery at the Files drawer breakpoint

November 21, 2026 Cairo. Bounded shared UI source candidate; no native, release or milestone acceptance.

**Issue.** At the existing 900 CSS px breakpoint, the stylesheet hides the editor's closed drawer regions and desktop Collapse control on narrowing and hides the narrow Files trigger on widening. The previous renderer listener updated hidden-membership counts only. It did not choose a visible recovery target when focus was already in one of those controls. Static CSS and controlled focus establish the missing handoff, not what an actual browser previously focused after resizing.

**Source change.** Keep the departing focused element rendered until the media-query handler can move focus. On narrowing, an editor's focused desktop Collapse button or focus inside a closed drawer region moves to that editor's Files and selection trigger. On widening, focus on that trigger moves to the visible desktop list toggle, or falls back to the same selected workspace if no visible editor list exists. Jobs is not an editor drawer. Unrelated controls and the open drawer's still-visible controls keep focus. Neither the responsive handoff nor its styling changes selected files, opens/closes the drawer, edits a draft, starts/cancels work or adds preload calls.

**Exact source and evidence.** Original 130: `4724512d1822cbbf5b9e2368a730cbb4499a6a1f`, tree `6fed263782378df8532a5c6fd684cf9122ae9428`. Frozen source patch SHA-256 `34c8276ccaeb550a23d5cba66db8f0ef784b6a7927276950048b9fc561b76500`, cold reconstructed source tree `e542394f131dacf89a9c4c7a3ef0e5c8b423dc1b` (not an integrated commit). Active Linux closure: 158 verified; one existing renderer tuple changed. Inert plan: 188 source rows independently rehashed; only renderer, CSS and the qualification file identities changed; 88 external definitions, topology and ineligibility flags stayed identical.

| Receipt | Bounded result |
| --- | --- |
| `20261121T005311Z_r06-responsive-red-130` | First baseline attempt ended early after 53 passes and a file-level failure while formatting the first differing test element. Not the definitive red. |
| `20261121T005342Z_r06-responsive-red-r02-130` | Baseline with final tests: 94 passes, four expected failures, no skips; exit 1. Closed Encode handoff, hidden Jobs fallback, CSS selector contract and Remux Collapse handoff. |
| `20261121T005432Z_r06-responsive-green-r01` | 239 passed, no failures or skips; exit 0 across seven affected renderer/vendor/draft/EncoderService/Linux source suites. |
| `20261121T005506Z_r06-responsive-cold-r01` | Same suite and counts from exact cold apply; overlapping, not additive. |

**Remaining native check.** Node v24.22.3 ran controlled DOM and source tests. No pinned working Electron/display setup on this executor was established; no browser launch, native process, pixels, resize, 640×480 layout, DPI/GPU, screen reader or Windows result is claimed. In an approved isolated exact app session, focus a keyboard-reachable file row/filter with the drawer closed above 900 CSS px, narrow below it, and verify the visible Files trigger with unchanged membership; widen with focus on that trigger and verify the desktop list control. Repeat with open drawer and in Current Jobs; verify no focus theft and no operation. Follow with separate actual CSS content, outer window, DPR and overflow/Cancel focus measurements at the claimed minimum. This does not close R06 or permit release.

**Handoff.** Compare both patches and replay the cold check after integration. Any other change to the pinned qualification source requires computing the final inert digest from its merged bytes. Prior native tests belong to their original runtime/source and do not qualify this change.
