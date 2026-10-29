---
name: evidence-run
description: Run FFmpeg Encoder node:test suites with an immutable evidence receipt (stdout, stderr, exit code, duration, Node version, HEAD, and SHA-256 of every tested and covered file). Use for every test result that will be cited in project records or commit messages.
---

# Evidence-bound test run

```bash
node .claude/skills/evidence-run/run-tests.cjs <label> <test files...> --covers <source files...>
```

- Receipts go to ignored `artifacts/v0.7/evidence/<UTC>_<label>/` (`stdout.txt`, `stderr.txt`, `receipt.json`). They are never overwritten; a failed run stays failed and is cited as such.
- `--covers` lists the source files the claim is about; their hashes bind the result to exact bytes. A later edit to any of them makes the receipt historical for changed claims.
- The runner marks FAIL if any listed file changed during the run.
- Cite results as: label, pass/fail/skip counts, exit code, receipt folder. Never add counts from different receipts together as one result.
- These are pure/injected/small-fixture tests unless the test itself drives real FFmpeg or the app. Say which, and never present them as hardware, media or GUI acceptance.
