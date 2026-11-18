# Physical application layout correction (current)

This supersedes active-ASAR placement in the historical sections below. Pinned Electron 44.7.0 virtual ASAR stat/open behavior is incompatible with unchanged retained-handle identity checks. This is a source-based prediction, not an observed native failure; no verifier check was weakened.

Application files now live under `electron/resources/app` as ordinary single-link files. No active `electron/resources/app.asar` or `.asar.unpacked` is permitted. The exact-member archive exists only at `audit/app.asar`, outside launch resources, with its generated size/hash and exact membership verified. Runtime paths stay `electron/resources/runtime`.

The real-directory test found one missing fixed-plan member: `linux-blue/workbench-long-range-calibration.cjs`, already required by unchanged 115-file product closure and original 97 measured pins. Its exact existing bytes were added; no pin was rebaselined. Current plan: 132 application rows, 225 total inputs, 391326474 input bytes. All 115 required paths are covered. No raw calibration reports or workspace artifacts were added.

Five package tests pass, including real lstat/fstat identity, absence of active ASAR, and actual qualification/source verification before and after relocation. Full affected suite: 61 passes, no failures/skips. Only app source and tiny fixtures were copied, not actual runtime binaries or a full package. Activation review/preservation and native publication remain gates; distribution/dependency/notices limitations remain open.

## Earlier proposal history

# Current packaging revision: internal opt-in source snapshot

The baseline document below describes the prior disabled composition. The current separate activation delta changes only two application inventory rows (qualification loader and compact record). It retains 224 total inputs and 131 application rows; current input total is 391293012 bytes. Original runtime/license and 97 measured producer identities are unchanged. `ACTIVATION_PACKAGE_HASH_CHANGES.json` records the exact two updates.

Independent activation review and durable preservation remain prerequisites for any actual package/launch. Native publication is pending, not satisfied by prior service evidence. The output is still inert, non-executable and not for distribution. No real package was built. Full source/notices/dependency/portability obligations below remain open.

## Preserved baseline packaging explanation

# Offline Linux product-package proposal

## Concrete deliverable

The fixed `resources/linux-inert-package-plan.json` lists 224 exact files, totaling 391,289,821 bytes. It includes 131 application files (the existing source allowlist plus literal relative dependency closure of the disabled product composition), the inspected Electron 44.7.0 Linux x64 distribution, the exact rebuilt FFmpeg/ffprobe pair, actual runtime/component notices and build/acquisition provenance. Application files are staged and additionally packed into `electron/resources/app.asar`, with every archived source member read back and hash-checked, the exact member/directory set asserted, and the complete generated archive size/SHA-256 recorded in the output inventory. The pair resides in `electron/resources/runtime`, matching the product composition's packaged resource route.

`build-linux-inert-package.cjs` is an explicit engineering API, not a CLI/IPC or app hook. It uses only local inputs and existing approved `@electron/asar` 4.3.0 tooling. It does not invoke packager hooks, install, download, spawn a binary, produce a release ZIP, publish or change defaults. Copying the already inspected Electron distribution avoids invoking a downloader entirely. Existing packager is available but is not necessary to prove this directory/resource composition.

All copied files and the ASAR are non-executable. Output is a fresh exclusive directory, never an overwrite; failures retain partial inert output rather than recursively deleting unknown files. The full input set is verified before output creation, each copy is checked again, and source roots and output owner are rechecked. The 27 GiB residual floor includes twice the admitted input size plus 64 MiB for ASAR overhead. This is still point-in-time capacity, not a quota, and is not secure against a malicious same-user directory swap. The builder is unconnected main-owned engineering code, not a hostile filesystem service.

## Exact input roots for this prepared proposal

- source: the isolated `ffmpeg-linux-product066-integration-proposal` snapshot, not mutable main or another worker's checkout.
- electron: `electron-44.7.0-setup/node_modules/electron/dist` from the existing approved setup.
- inputs: `runtime-requalification-inputs-20261117`, holding verified FFmpeg source and extracted official codec-development packages.
- guidance: the existing evidence root, for exact candidate build pair and acquisition/build receipts.
- hostDocs: `/usr/share/doc`, with canonical resolved copyright paths, not copied host libraries.

No actual 391 MB package was built in this task. Tests created only inert tiny fixtures and a real fixture ASAR through the already installed tooling. The source plan retains exact hashes, so later composition edits must be deliberately reviewed and regenerated; they do not silently flow into a build.

## Runtime and source provenance

Electron provenance is the saved byte verification of official Linux ZIP `3ae7d5bdad61c664486c6ab61361dd084d064c8c08af8d13a687096e18ce555a` (122,998,223 bytes) and its extracted inventory. Actual Electron `LICENSE` and `LICENSES.chromium.html` are included. They are not replaced by icon artwork notices.

The candidate pair is the exact build recorded in `runtime-candidate-build-20261117/BUILD_RECEIPT.json`: ffmpeg SHA `ae5b2e8b48ad0e9b51b89ebab000ebcfc0b76a09b8cb80c88e18fddcc5d9e8ba`, ffprobe SHA `923dab8640da8804c445418b6e2efe4b395665bdb9d4cfc84f6a244ed0fb156b`. FFmpeg source origin, signed source tarball hash, extraction and actual build plan/receipt are retained. The four GPL/LGPL COPYING texts and FFmpeg LICENSE.md are included from that source tree. Copying all these notices is evidence preservation, not a legal conclusion about the correct combined license.

Official extracted x264, x265, numa, dav1d and SVT-AV1 development-package copyright files are included separately. Exact-host libc, libgcc, libstdc++, dav1d and SVT runtime copyright records are also inventoried. Current local copyright files do not independently establish full corresponding-source completeness for every linked component.

## Dependency strategy and actual blockers

The first slice deliberately retains the seven exact host libraries and soname mappings already required by the product runtime verifier. No libc, dynamic loader, libstdc++, dav1d or SVT library is bundled, and no LD_LIBRARY_PATH or loader search override is introduced. Pair relocation is therefore meaningful only on the same inspected host-library identities. GLIBC_2.38 is an observed necessary symbol floor, not a supported distribution guarantee. Electron's separate system dependencies also remain a native launch prerequisite.

Distribution remains blocked on:

1. Independent product-composition acceptance and actual native proof. The copied composition retains its pre-runtime stop. Packaging cannot activate it.
2. Complete corresponding-source/build provenance review for the linked x264/x265/numa and dynamic components, and the actual method of satisfying distribution obligations. Existing binary development packages plus notices do not settle this. No external legal conclusion or release authorization is claimed.
3. Exact Electron/runtime dependency compatibility and one relocated native application-shell test, with user-data outside the install tree. The inert modes must not be changed until a separately authorized tested package step.
4. A deliberate supported-distro/architecture baseline and future GPU tests. Those are not prerequisites for reviewing this inspected-host inert proposal, but are prerequisites for broader support claims.

This proposal does not choose to bundle host libraries now. Doing so would change the verified runtime closure and require a fresh narrow qualification/retest decision, not just copying more files.

## Review and next useful step

Review the fixed file plan, bounded transfer implementation and four fixture tests. The tests cover inventory scope, malformed plans, actual ASAR readback, non-executable output and tampered-input refusal before output creation. They do not prove actual Electron launch, FFmpeg operation, hostile races, a complete source-closure static analyzer or a release.

The next useful step after source acceptance is one offline staging of the real pinned files and a separate reviewed native application-shell proof when the composition stop is legitimately resolved. Do not add more generic packaging registries or treat this inert output as a ready installer.


## Prospective checkpoint 066 reconciliation

The source snapshot was reconciled against all 732 files of committed checkpoint 065 (`e9df1ed78cf1ade0b6c322ead652644c482d9662`), then overlaid with the reviewed seven-file disabled composition and four-file packaging proposal. All 115 product source pins, the unchanged 97 measured calibration producer pins, 131 application plan rows and all 224 package input identities match without any producer or package-plan hash refresh. The prospective checkpoint 065 changes introduced no mismatch in these pinned sets. Documentation clarification here does not change the 224-file input plan.

Sixty focused file/injected tests passed with zero failures/skips using existing approved ASAR tooling. Source CI passed 211 syntax files, 243 shared tests and 20 Linux tests. Counts overlap. Only tiny fixture ASARs were built; no real 391,289,821-byte input package, runtime, installation or native execution occurred. The production pending stop and unresolved notices/dependency/activation obligations remain unchanged.
