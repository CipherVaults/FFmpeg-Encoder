---
name: reentry-check
description: Read-only FFmpeg Encoder re-entry verification — branch/HEAD/private-remote equality, empty index, no staged Planning, protected 0.5/0.6 tags, the 24 private Planning hashes and the 43 requirement IDs/texts. Use at session start, after compaction, before commits, and at every PBS handoff.
---

# Re-entry check

Run from the repository root:

```bash
node .claude/skills/reentry-check/reentry-check.cjs
```

- Every line prints PASS or FAIL with the observed value. Any FAIL means: stop dependent work, preserve the state and investigate; never "fix" a protected mismatch by overwriting it.
- `--baseline` re-records the protected baseline (`artifacts/v0.7/claude-continuation/protected-baseline.json`). Use it only after a verified checkpoint, and say so in the session record.
- The requirement digest hashes only the ID and requirement-text columns of tracker 25, so status/evidence edits are allowed and requirement text edits are detected. Its method matches the October 26 readback digest `131186ff1f021a22…`.
- "HEAD equals private remote" is expected to FAIL between a local commit and its push; it must PASS after every push.
