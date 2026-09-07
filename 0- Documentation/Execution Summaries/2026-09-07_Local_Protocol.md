# Milestone G — Local application protocol

September 7, 2026. This report belongs to the commit that adds it. The preceding architecture checkpoint is `b7d56df`; Electron and FFmpeg upgrades remain independently recoverable.

## Result

The app loads `app://encoder/index.html` through a dedicated session and a three-asset exact GET allowlist. Requests cannot supply filesystem paths, query parameters, credentials, ports, or arbitrary schemes. CSP response headers deny inline execution, connections, frames, objects and base/form changes. Navigation, popups, downloads and permissions remain denied. IPC authenticates the exact trusted entry URL and main frame.

## Verification

- `npm test`: 89 passed, zero failed, including two new protocol tests. Existing architecture and historical characterization suites retain their meaning; the count alone is not native evidence.
- `node scripts/protocol-smoke.cjs`: native Electron/Chromium security checks passed. Report: `artifacts/protocol-smoke-1788789338099/report.json`. All three assets return CSP/nosniff; session requests deny private source files, encoded/double-encoded traversal, extra URL components, foreign/file/network URLs and POST. Injected inline code/handlers, frame and fetch attempts are blocked. Notifications and popups are denied; renderer navigation is prevented with only one window remaining.
- `node scripts/app-smoke.cjs`: real two-file inspection/encode/validation/publication/full-decode/new-batch skip flow passed on the custom protocol. Report: `artifacts/app-smoke-1788788966445/report.json`. Native picker return is substituted; this does not prove OS picker interaction.

One initial native assertion expected `will-navigate`, but `will-frame-navigate` cancelled navigation first. The test was corrected to assert the actual prevented event; no product bypass was introduced. Sender/frame/payload rejection remains covered by the IPC suite separately from native resource-policy tests.

## Parent synchronization and next step

The parent reconciled Current State, Roadmap, acceptance gates, Execution Index, Session Summary, Architecture and Security/Testing against these results and live Git. The technical reference retains the media/IPC contracts; this report and architecture document describe the implemented protocol.

G is complete. H still needs real UI settings/collision/mixed-result and responsive/DPI evidence, final profile/default policy reconciliation, and requirement-level media evidence review. I still requires the offline extracted portable ZIP and final documentation/version/checkpoint. No GitHub upload or public release is authorized by this local checkpoint.
