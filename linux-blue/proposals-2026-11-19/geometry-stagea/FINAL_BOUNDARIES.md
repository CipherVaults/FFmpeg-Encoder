# Final narrow boundaries

Corrected predecessor and review a11e07709b6df65ea2a10a1222e2c0ce2f5be69f81e84cfbfe471edc34f8f077 remain intact. Runtime post-open timer/monitor setup now runs in checkedSetup, which owns the handle on every setup rejection and retains primary plus close failures. Partial timers are cleared on setup failure. The actual finalGuard rechecks deadline after the awaited owner guard before returning. Forty inert tests pass, including delayed final owner, expiry before timer creation and setup-plus-close error ordering. No media, binding or canonical changes.
