# Historical CPU component recovery-kit instructions

This is the recovery kit's original README, preserved when the Linux branch's root README was updated. Its commands and evidence describe the small kit at delivery, not the whole current repository. Paths below are relative to the **repository root** (or the original extracted kit root), not this document's directory. Historical statements about excluded files and missing GUI integration are not current branch inventory.

The root `FILE_HASHES.json` describes the original kit; its `README.md` entry no longer describes the rewritten repository README.

---

# FFmpeg Encoder: Linux CPU component recovery kit

Private owner deliverable, November 16, 2026. This is a small runnable developer
experiment, **not the complete application, a full source backup, or a release**.
It is independent of the untouched Windows project. No GitHub upload is performed
by this package. Nothing here authorizes public distribution or merging Windows.

## What you can do

From this extracted directory, with Node available:

```sh
node --test tests/media.test.cjs tests/container-clock.test.cjs tests/process-runner.test.cjs linux-blue/runtime.test.cjs
```

No npm install is required. Those exact packaged files passed all 88 selected
tests during recovery. Run the tiny synthetic CPU experiment only on the qualified
Linux x64 host, as an ordinary non-root account:

```sh
node linux-blue/pilot.cjs
```

The pilot expects the exact reviewed Debian FFmpeg 7.1.5 executables at
/usr/bin/ffmpeg and /usr/bin/ffprobe, whose pins are in linux-blue/runtime.cjs.
It deliberately refuses other executables, writable tools and loader overrides.
Do not change the pins just to make a run pass. Other systems require separate
runtime review. Dynamically linked libraries remain host dependencies.

The pilot creates its own tiny synthetic media and receipts under
linux-blue/artifacts/. It runs H.264, H.265 and AV1 sequentially with existing CPU
defaults. It checks complete decoding, 12 frames, stream/color/audio properties,
no overwrite, cancellation and child cleanup. No existing personal media is used.

## Scope

The nine exact source/test files support the selected tests and pilot. This kit
intentionally does not include the application or the full module dependency
closure. Optional preservation/provenance paths in media.cjs refer to omitted
production modules and are outside this kit; do not invoke those optional APIs.
Do not use this component subset as a drop-in app repository or run npm start.
The originals have not been edited to remove those paths.

Evidence includes the existing verified pilot summary and a fresh 88-test log.
The existing final raw receipt, synthetic source and all three outputs were
rechecked against recorded hashes. The raw receipts/media remain preserved in
the original local experiment; no repeat pilot was run solely to refresh time.
Earlier failed runs are described in the summary and remain failed.

The source origin was codex/v0.7-candidate at
1b9838a0c4a9379ef36032ddea4c422e66aaea9b plus captured PC edits. This kit is not
those edits in full. Original modules/tests in this kit match intake hashes.
FILE_HASHES.json lists every delivered file except itself with SHA-256 and size.

## Deliberately excluded

Full application/assets and unrelated tests, historical docs/private Planning,
old instructions and skills, original private intake manifest, Git history,
credentials, personal media, generated media, binaries, node_modules and local
app state. The complete 681-file intake and larger experiment remain untouched.
No broad privacy guarantee is implied by the bounded credential-pattern scan.

## What has and has not been proven

Proven: the exact selected component tests and three tiny synthetic CPU cases on
one Linux host. NOT proven: GUI/service integration, complete Linux application,
Windows/NVIDIA/AMD/Intel compatibility, HDR, representative quality/performance,
production qualification, packaging, release or acceptance.
