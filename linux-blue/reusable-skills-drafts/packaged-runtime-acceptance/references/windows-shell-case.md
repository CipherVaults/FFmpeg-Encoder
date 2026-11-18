# Windows Electron shell-launcher case

Project-derived example, not a universal Electron or Playwright API guarantee. Recheck the pinned implementation when versions or launch options change.

## Implementation distinction

The inspected Playwright 1.63.0 Windows Electron launch path used shell:true and exposed the launched shell child through app.process(). Comparing that process's OS executable path directly with the packaged executable was the wrong identity model.

The successor retained launcher and app-main identities separately. Reviewed guards included:
- Returned child PID and still-unset exit/signal status.
- Launcher canonical System32 cmd.exe path and parent PID equal to the harness PID.
- Stable creation-time/path observations before accepting launcher ownership.
- Actual main PID/executable paths from the app, corroborated by OS records and exact pinned executable bytes.
- Bounded ancestry to the validated launcher, rejecting parents created after children.
- Fresh identity matching before cleanup; rejected observations never granted authority.

These checks reduce stale-PID risk, but process inspection and signaling are not atomic. Do not claim race-free or exhaustive ownership from a sampled tree.

## Observed result and limits

Checkpoint 071 failed launch validation before the requested encode; cleanup had a separate timeout and forced owned-tree outcome. Its sanitized report did not retain the unexpected executable path, so the exact historical path was not claimed.

Checkpoint 072's authorized successor reported:
- Packaged Windows CPU integration passed with normal closure.
- One synthetic fixture and one requested CPU encode.
- Sandbox/context isolation enabled, node integration disabled.
- Source/package unchanged, collision refused, output hash retained.
- Five samples, ten observed descendants, zero observed live after close.
- Dialog returns substituted; native desktop and GPU not qualified.

The package was not distributed. Independent observation retrieved and hashed the sanitized report, rather than downloading or rerunning the executable. Correct the ownership model and narrow the claim; do not infer broad Windows acceptance.
