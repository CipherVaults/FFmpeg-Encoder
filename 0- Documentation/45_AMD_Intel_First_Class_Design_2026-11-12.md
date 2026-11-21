# 45 — AMD and Intel as first-class ordinary encoders: design (November 12, 2026)

**Status:** root-adopted design, the revision of [record 37](37_Native_Service_Integration_Design_2026-10-30.md) that [record 43](43_AMD_Intel_First_Class_Decision_2026-11-01.md) §4 asks for. Owner: Ahmed. Writer: Claude (root). Build: Codex, in reviewed slices (record 40). **§12 below (review amendments) overrides the design text wherever they differ.**

**How it was made:**
- Three independent designs, each from a different angle (byte identity first, security first, full spectrum first), were scored by two judges and merged by one agent. This was Claude workflow `wf_cc356d2d-d80`; the result is in `artifacts/v0.7/amd-intel-design/`.
- An independent Codex review followed: `amd-intel-design-review`, receipt `artifacts/v0.7/codex/20261112T054215Z-amd-intel-design-review-29d474`. Its verdict: "Sound with changes." It raised 1 high, 4 medium and 2 low issues and found no blocker.
- Root adopted all seven issues as §12.

**Citations:** these are at `8d8b510`. `f8fc2df` changed only `src/encoder-service.cjs` :255-284 and :335-337 in place (line-neutral), `src/diagnostics.cjs` :183 and `src/native-file-workspace.cjs`, so every other citation holds.

**Basis.** All citations are at HEAD `8d8b510`. The working tree has uncommitted edits to `src/encoder-service.cjs`. They are line-neutral (4 lines replaced in place at :281-284 and :335-337), so every encoder-service line below holds.

**Why this starting point.** The two judges picked different winners: `identity` and `security`. Their summed scores are identity 78, security 72 and fullspectrum 69. This design therefore starts from `identity`. It takes security's guards and security's device binding. It takes fullspectrum's adapter search and display ideas.

**Corrections applied, re-checked in the code:**
- **backend-adapters.cjs lines.** The H.264 8-bit row is at :53. `qpFields` is at :59. `defaultMode` is at :60. Native ids are at :62. The seeds are at :74 (balanced for AMF, medium for QSV). The index bound is at :135. QSV ICQ/CQP is at :161-170. The pixel, profile and upload fragments are at :172-175. The device arguments are at :189-192.
- **Other line numbers.**
  - The `this.verify(...)` call is at encoder-service.cjs:1784. Line :1793 is `validatingSource = true`.
  - `observe` refuses non-CPU/NVIDIA at operation-runtime.cjs:188.
  - The capability rethrow is at capabilities.cjs:192.
  - `requireCurrent` before publish is at encoder-service.cjs:1825.
  - The NVIDIA pixel set is at media.cjs:61. The CQ 0 note is at :58-59.
  - `#vendor-beta-note` is at index.html:66. The Native backend checks panel is at :175-195.
- **Supported hardware devices.** The pinned help lists `d3d11va dxva2 amf` for the three AMF wrappers and only `qsv` for the three QSV wrappers (runtime-observations/*_amf.txt:4, *_qsv.txt:4).
- **Pinned version.** The binary reports `9.0.1-full_build` (runtime-observations/ffmpeg-version.txt:1), and media.cjs:24 says 9.0.1. CLAUDE.md says 9.0.2, and operation-runtime.cjs:184 writes the label `FFmpeg9.0.2`.
- **The current argv pin cannot catch a builder change.** encode-operation.test.cjs:64-78 compares two calls into the same builder.
- **0.6 and a version-3 preferences file.** On that file, 0.6 throws `Unrecognized preference schema` (preferences.cjs:36-38), goes read-only and uses defaults for everything. So the vendor settings go in a separate file.
- **Two identity points are reversed:**
  - Vendor suffixes are added to `HISTORICAL_SUFFIXES`, because `historicalSuffix` (provenance.cjs:170-174) exists for outputs whose marker is missing.
  - `planFingerprint` (encode-operation.cjs:147) hashes the twin's settings. It does not bind the vendor tuple. The main-private `argsHash` does.
- **Fullspectrum errors not repeated.** AMD QP 0 is allowed: the AMF `-qp_*` options run from -1 to 51/255, and the native table min is 0 (backend-adapters.cjs:68). The seeds are not changed. The Beta UI is not removed.
- **Security errors not repeated:**
  - No `wrapperObservations` call inside the capability check. capabilities.test.cjs:78 forbids `-encoders`.
  - No change to operation-qualification.cjs:144. Vendor ids never reach it. `settings()` at :67-69 already refuses them with `INVALID_SETTINGS`.
  - `AMF_PRESETS`/`QSV_PRESETS` are not exported (:295-298). The design uses exported `NATIVE_PROFILES` and `nativeEncoderContribution` instead.

## 1. Summary

- **What it adds.** Six profiles: `h264-amd`, `h265-amd`, `av1-amd`, `h264-intel`, `h265-intel`, `av1-intel`.
  - They run on the ordinary Full/KeepSource compatibility path, with the same `{profileId, preset, quality}` tuple (media.cjs:79-82).
  - They use the same queue, staging, provenance marker and publication.
- **Protected files.** No byte changes in `src/media.cjs`, `src/encode-operation.cjs`, `src/operation-family.cjs` or `src/operation-contract.cjs`. No existing test file is edited. `PROFILES` stays the six accepted rows.
- **Main mechanism: a codec twin overlay.**
  - Each vendor profile names a CPU twin of the same codec: `h264-cpu`, `h265-cpu` or `av1-cpu`.
  - Main builds the twin's genuine plan with the accepted builder (`buildEncodeOperation`, encode-operation.cjs:162-207). The twin supplies mapping, metadata, colour, HDR refusal, provenance placement and the expected output.
  - A pure, shape-checked overlay then swaps four things:
    - the codec name;
    - the preset and rate-control run;
    - the pixel block (the reviewed upload, profile and pixel format fragments);
    - the device arguments before `-i`.
  - Anything unexpected fails closed with `VENDOR_ARGV_SHAPE`.
- **Device binding.** The design uses the reviewed native upload syntax: `-init_hw_device … -filter_hw_device …` plus `format=nv12|p010le,hwupload` and `-pix_fmt d3d11|qsv` (backend-adapters.cjs:172-175, 189-192). The frames live on the chosen adapter, so an encoder cannot quietly open the default adapter.
- **Outputs are checked harder than NVIDIA's,** for vendor profiles only:
  - the ordinary checks;
  - a check of the stream `ENCODER` tag;
  - a three-way frame count with a strict decode;
  - a DXGI recheck before spawn and before publish.
- **Scope.** Changed routes (range, resize, audio transform, timed-track omission) and HDR are refused with specific codes. Today the only measured families are CPU slow25 and NVIDIA p5CQ25 HEVC (operation-family.cjs:61-64), and HDR is deferred (record 35).

## 2. Profile table

All six profiles share:
- `hardware: 'AMD' | 'Intel'` and `tier: 'untested'`;
- labels such as `H265 · AMD` and `H265 · Intel`;
- suffixes such as `H265-AMD-GPU` and `H265-Intel-GPU`.

The ids differ from the native ids `h265-amf`/`h265-qsv` (backend-adapters.cjs:62). A test asserts that the two id sets do not overlap.

| id | encoder | twin | depths | presets (start) | quality: mode, range, start | source → upload format | device args before `-i` |
|---|---|---|---|---|---|---|---|
| h264-amd | h264_amf | h264-cpu | 8 | speed/balanced/quality/high_quality (balanced) | QP (CQP, I=P=B) 0–51, 24 | yuv420p→nv12 | `-init_hw_device d3d11va=ffenc_d3d:N -filter_hw_device ffenc_d3d` |
| h265-amd | hevc_amf | h265-cpu | 8, 10 | same (balanced) | QP (CQP, I=P) 0–51, 24 | + yuv420p10le→p010le | same |
| av1-amd | av1_amf | av1-cpu | 8, 10 | same (balanced) | QP (CQP, I=P=B) 0–255, 128 | same | same |
| h264-intel | h264_qsv | h264-cpu | 8 | veryfast…veryslow (medium) | ICQ 1–51, 25 | yuv420p→nv12 | `-init_hw_device d3d11va=ffenc_d3d:N -init_hw_device qsv=ffenc_qsv@ffenc_d3d -filter_hw_device ffenc_qsv` |
| h265-intel | hevc_qsv | h265-cpu | 8, 10 | same (medium) | ICQ 1–51, 25 | as h265-amd | same |
| av1-intel | av1_qsv | av1-cpu | 8, 10 | same (medium) | QP (CQP, I=P=B) 0–255, 128 | as h265-amd | same |

- **Where the values come from.** Presets, ranges and start values come read-only from the exported `NATIVE_PROFILES` (backend-adapters.cjs:57-79). The UI labels them "Starting values (untested)", never "Tested Default" (:77-78).
- **Where the option syntax comes from.** The encoder fragments come from the exported, pure `nativeEncoderContribution` (backend-adapters.cjs:146-180), called with the matching native id and the upload pipeline it requires (:153).
  - CQP passes `{i:Q,p:Q,b:Q}`, or `{i:Q,p:Q}` for hevc_amf.
  - This keeps one source of AMF/QSV syntax. It is a pure function, not native state.

**The reason for each limit:**
- **H.264 is 8-bit only.**
  - h264_qsv accepts only `nv12 qsv` (h264_qsv.txt:5).
  - h264_amf has no `-bitdepth` and no High 10 profile (main/high/constrained only, h264_amf.txt:14-18).
  - The AMF `p010le` entry is one shared wrapper table: all three AMF files have the same line 5.
- **4:2:0 only.**
  - The upload converts to nv12 or p010le. Any other input would let `format=` silently change chroma or range.
  - So `vendorPixelFormat` accepts only `yuv420p` and `yuv420p10le`, before any argv exists. 4:2:2, 4:4:4, gray, alpha and `yuvj*` are refused with `UNSUPPORTED_PIXEL_FORMAT`.
  - hevc_qsv's packed 4:2:2/4:4:4 formats (hevc_qsv.txt:5) need a packing conversion that has not been qualified. They are deferred, not hidden.
- **`nv12`/`p010le` sources are refused.** NVIDIA accepts them (media.cjs:61). This is a limit of the twin, not a hardware limit: the CPU twin tables (media.cjs:20-21, 49) do not carry these layouts. Decoded camera and screen recordings report `yuv420p` or `yuv420p10le`, so this is rare. Lifting it needs an additive media.cjs change, which is owner decision O3.
- **No 12-bit.** It is outside product scope (media.cjs:36-38).
- **One quality number.** The tuple has no mode field (media.cjs:79-82).
  - AMD uses CQP. QVBR with `-b:v 0` may follow a hidden driver target that cannot be read back (B-AMF-PRODUCER). CQP asks for no hidden quantity.
  - hevc_amf has no `-qp_b` (hevc_amf.txt:74-75; backend-adapters.cjs:59).
  - Intel H.264/HEVC uses ICQ through `-global_quality`, and Intel AV1 uses CQP (backend-adapters.cjs:60, 161-170).
- **No hard-coded resolution or generation limits** (record 43 §3.3). A device maximum shows as a per-file encode failure, with no fallback.
- **No Archive recipe.** Archive CQ29 is bound to `h265-nvidia` (media.cjs:68-72). Vendor settings refuse `recipeId`.

## 3. Capability and startup check

- **`checkCapabilities` is unchanged** (capabilities.cjs:68-245). The 6-profile result keeps the pins at capabilities.test.cjs:71 and :77-78.
- **Export-only change in capabilities.cjs.** `verifyVideo`, `parseProbe` and `failureReason` are added to `module.exports` (:247). No statement changes.
- **New `src/vendor-capabilities.cjs`.** It exports `checkVendorCapabilities({ffmpeg, ffprobe, stateDir, signal, run, adapters = queryWindowsAdapters})`. It works in four steps.
  1. **Its own DXGI read.** It calls `queryWindowsAdapters` (windows-adapters.cjs:139-158), whose rows are validated at :114-136. Candidates are non-software rows with `backendCandidate` `amf` or `qsv` (:135-136), at most 4 per vendor, in DXGI order.
     - No candidate: every profile for that vendor gets `VENDOR_NO_ADAPTER`, and no encode runs.
     - Query failed or not on win32: `VENDOR_DISCOVERY_INCOMPLETE`.
     - On Ahmed's NVIDIA-only machine, the cost is one helper run.
  2. **Per profile and catalog depth, try the candidates in order.** For each candidate it runs:
     - the production argv `overlayVendorArgs(buildEncodeArgs(twin…))` on its own two-frame FFV1 8/10-bit fixtures in `stateDir/vendor-capability-*`;
     - `ffprobe -count_frames` with `verifyVideo`;
     - the strict `-xerror` decode with `frame=` and `progress=end`, the same method as capabilities.cjs:144-188.

     The first adapter that passes is bound for that profile and depth. H.264 10-bit runs nothing and is reported as `VENDOR_DEPTH_NOT_OFFERED` with its §2 reason.
  3. **Limits.** Each child gets a 20 s timeout, as at capabilities.cjs:82. Each vendor gets a 90 s budget. After that, the remaining cells get `VENDOR_CHECK_BUDGET`.
  4. **Result rows** have the `checkCapabilities` profile shape (capabilities.cjs:197-208), plus `tier`, `disclosures`, `device: {description}` and `reasonCode`.
     - The renderer gets fixed `VENDOR_MESSAGES[code]` text.
     - The stderr tail and stage paths go only into `context.nativePrivate`, which diagnostics withholds (diagnostics.cjs:31-34).
     - Known qsvenc warning lines ("incompatible video params", partial acceleration) are matched against a fixed list. They become a shown disclosure (`VENDOR_PARAMS_ADJUSTED`), not greying.
     - `VENDOR_MULTIPLE_ADAPTERS` is a disclosure, not a failure.
- **Binding.** Each binding is a frozen record: `{vendor, adapterIndex, luid, vendorId, deviceId, umdVersion, description}`. It is branded in a module-private WeakSet and kept in a private `#vendorBindings` Map on the service. The Map is set with `capabilityResult` (encoder-service.cjs:486) and cleared with it (:495).
- **One seam in `#getCapabilities`.**
  - It sits after discovery (encoder-service.cjs:477-482) and before `CAPABILITY_FINISHED` (:483): `if (this.vendorCapabilities) capabilityResult.vendorProfiles = …`.
  - Any error other than `CANCELLED` is contained: every vendor row becomes unavailable with `VENDOR_CHECK_FAILED`. Ordinary startup cannot fail because of vendors.
- **Composition.** The constructor option is `vendorCapabilities = null` (encoder-service.cjs:103-106). main.js:180 passes `checkVendorCapabilities`. The vendor path never reads `nativeBackends`, the discovery registry or `nativeCapabilities` (record 37 invariant 1).

## 4. Builder changes

- **New `src/vendor-profiles.cjs`:**
  - `VENDOR_PROFILES`, deep-frozen;
  - `VENDOR_TESTED_EVIDENCE = []`, frozen, for the later "tested" tier;
  - `validateVendorSettings`: the same plain-object, exact-key and no-accessor checks as media.cjs:74-82, for vendor ids, with `recipeId` refused;
  - `vendorPixelFormat`;
  - `describeVendorRecipe`, with the shape of media.cjs:116-145 and AMF/QSV help text;
  - `vendorFragments(profile, settings, bitDepth)`, which wraps `nativeEncoderContribution`.
- **New `src/encoder-catalog.cjs`:**
  - `resolveCatalogSettings(request)`. For a non-vendor id it returns `media.validateSettings(request)` unchanged: same object, same errors. For a vendor id it returns `{settings, profile, twinSettings}`, where `twinSettings` is the twin's default tuple.
  - Also `catalogProfile(id)`, `describeCatalogRecipe` and `catalogCapability(caps, id)`.
- **New `src/vendor-encode.cjs`, `overlayVendorArgs(twinArgs, {twinSettings, profile, settings, bitDepth, binding})`.** It asserts each piece exactly once, then replaces it.
  1. **Fixed prefix.** Tokens 0–11 must equal the literal prefix at media.cjs:390-393, and token 12 must be `-i`. The device arguments are inserted at index 12.
  2. **Codec pair.** `-c:v:0 <twin encoder>` must come directly after `'-c','copy'` (media.cjs:396). The encoder is replaced.
  3. **Preset and options run.** The expected run is derived from `describeRecipe(twinSettings)`: `presetContribution` plus options (media.cjs:129-130), not hard-coded. It must be directly followed by `-pix_fmt:v:0 +yuv420p|+yuv420p10le` (media.cjs:412). The run is replaced by the vendor preset and options.
  4. **Pixel pair.** It is replaced by `-filter:v:0 format=…,hwupload=extra_hw_frames=16` plus `pixelArgs` (`-profile:v:0 …`, `-pix_fmt:v:0 d3d11|qsv`, and `-bitdepth:v:0` for AMF HEVC/AV1).
  5. **Final checks.** The twin encoder, `-crf:v:0` and `-x265-params` must be absent. The vendor encoder and `-pix_fmt:v:0` must each appear exactly once. Otherwise `VENDOR_ARGV_SHAPE`.
  - **Device arguments.** `adapterIndex` must pass `Number.isSafeInteger` with a value of 0–63 (the pattern at backend-adapters.cjs:135). Device names are literals. The binding must carry the brand, its vendor must match the profile, and it is refused for CPU/NVIDIA. The codes are `VENDOR_DEVICE_REQUIRED`, `_INVALID`, `_MISMATCH` and `_UNEXPECTED`.
  - **Telemetry.** It returns compatibility plans unchanged (encode-operation.cjs:528), so the overlay sees the plain compatibility argv.
- **Example: h265-amd, 10-bit source:**

  `… -format_whitelist mov,matroska,webm,avi -init_hw_device d3d11va=ffenc_d3d:N -filter_hw_device ffenc_d3d -i IN -map … -c copy -c:v:0 hevc_amf <stream metadata> -quality:v:0 balanced -usage:v:0 transcoding -rc:v:0 cqp -b:v:0 0 -qp_i:v:0 24 -qp_p:v:0 24 -filter:v:0 format=p010le,hwupload=extra_hw_frames=16 -profile:v:0 main10 -pix_fmt:v:0 d3d11 -bitdepth:v:0 10 -fps_mode:v:0 passthrough <colour> <provenance> -default_mode passthrough -f matroska OUT`
- **Service seams in encoder-service.cjs.** No ordinary statement is rewritten. Each lookup goes through the catalog:
  - settings and recipe calls: :612, :623, :648;
  - preparation: :1050, :1067, :1105, :1193, :1196, :1203, :1228, :1241, :1374, :1427;
  - one early vendor branch in `prepareItem`, before the HDR branch at :872, following the native pattern at :871.
- **The vendor branch, in order:**
  1. Refuse HDR (`VENDOR_HDR_DEFERRED`) or unsupported colour (`UNSUPPORTED_COLOR`), so `prepareHdrItem` (:883) and hdr-workspace.cjs:66 never see a vendor id.
  2. Refuse a non-ordinary request (`VENDOR_ROUTE_UNQUALIFIED`) before any `operationRuntime.observe` call.
  3. Check the depth against `caps.vendorProfiles` and the binding.
  4. Build the version-3 generation description.
  5. Run `buildEncodeOperation` with `twinSettings`. If `prepareEncodePreservation` returns a selection, refuse with `VENDOR_ROUTE_UNQUALIFIED`.
  6. Overlay the argv, then set `preparedArgs` (as at :941).
  7. Store the main-private `entry.vendor = {profileId, settings, twinSettings, binding, argsHash, sourceFrameCount}`.
- **Execution** consumes `entry.preparedArgs` (:1679-1681) unchanged.
- **Provenance (provenance.cjs):**
  - `HISTORICAL_SUFFIXES` (:15) gains the six vendor suffixes.
  - A new `generationDescriptionV3` (`kind: 'vendor-encoder'`) is checked against the vendor catalog. It is dispatched at :109. v1 and v2 are unchanged.
  - Accepted 0.6 returns null for version 3, so it shows "Previous settings unavailable" (:165).
- **Preferences:**
  - A new `vendor-preferences.json` holds vendor settings: its own namespace, version 1, exact keys, the same atomic write.
  - The main file stays v1/v2. The main `profileId` may hold a vendor id: 0.6 shows a notice and selects H265 · CPU (preferences.cjs:47-48).
  - The 0.7 reader accepts a vendor `profileId` through the catalog.

## 5. Output verification

- **Ordinary validation, through the twin.** For vendor entries, `this.verify(entry.inspection, outputProbe, entry.vendor.twinSettings)` replaces `this.plan.settings` at encoder-service.cjs:1784. This covers:
  - codec (the twin has the same codec);
  - resolution;
  - depth, chroma and alpha by layout;
  - SDR tags, CFR and duration;
  - copied streams and chapters (inspection.cjs:428-526).

  The marker and description round-trip is unchanged (:1726-1731).
- **`vendorOutputCheck`, before `markStageValidated` (:1791):**
  1. **Depth.** The output depth must be one of the vendor profile's depths. This matters because the twin `h264-cpu` allows 10-bit.
  2. **Encoder identity.** The video `ENCODER` tag must match `^Lavc\d+\.\d+\.\d+ <profile.encoder>$` (`VENDOR_ENCODER_TAG_MISMATCH`). Ordinary metadata comparison ignores this tag (inspection.cjs:8). On an existing app output, the same tag reads `Lavc63.1.101 hevc_nvenc`. That output is `2026-10-09 21-19-08_H265-Nvidia-GPU.mkv`, probed read-only. This proves which wrapper ran, not which settings it used.
  3. **Three-way frame count.**
     - (a) At preparation, take the source count: the declared `nb_frames` of the selected video when present, otherwise a bounded `ffprobe -count_packets`. It is stored in `entry.vendor`.
     - (b) Take the encoder's last progress `frame=` value.
     - (c) Strictly decode the stage: `-xerror -map 0:v:0 -progress pipe:1 -f null -`, with `progress=end` required.
     - All three must be equal. The codes are `VENDOR_FRAME_COUNT_MISMATCH` and `VENDOR_OUTPUT_DECODE_FAILED`. A failure leaves the output unpublished, through the ordinary failure path.
  4. **Device recheck before publish.** A DXGI re-read must find the bound LUID, vendor, device and UMD at the bound index (`VENDOR_DEVICE_CHANGED`). The same recheck runs before each spawn.
- **What is not proven:**
  - the settings AMD actually applied (B-AMF-PRODUCER);
  - which Intel session adapter encoded the file (L-IDENTITY-ASSURANCE);
  - VUI colour tags inside the bitstream. Container-level tags are checked.
- **Diagnostics.** The result item and the `ENCODE_STARTED` context carry `hardwareTier: 'untested'`. `planFingerprint` does not bind the vendor tuple. `argsHash` (SHA-256 of the final prepared argv, device index included) does.

## 6. Relation to the native Beta panel and the P modules

- **Untouched:**
  - backend-adapters.cjs, beyond read-only use of its exports;
  - backend-discovery.cjs;
  - the native backend services and controls;
  - native-file-command/contract/runtime/controls/workspace;
  - `DEFAULT_NATIVE_FILE_POLICIES = []` (native-file-runtime.cjs:17);
  - the main.js:163-179 composition and its brand assertion.
- **Record 37 invariant 1 holds literally:** `PROFILES`, CPU/NVIDIA argv and defaults are unchanged, and no ordinary branch consumes native state.
- **Record 37 invariant 3 gets a scope note.** "Beta never enables Start" applies to the native path. Record 43 governs the ordinary vendor profiles. The Beta labels stay visible.
- **The Native backend checks panel** (index.html:175-195; renderer.js:39-90) stays as the exact-reference lab. Its machinery becomes the "tested" tier: owner-recorded rows in `VENDOR_TESTED_EVIDENCE` remove the mark for a matching vendor, codec, depth, device and driver. AMD's settings disclosure stays even then.
- **No concurrency.** Native checks need an idle service (`requireIdle`), so they never run alongside a vendor job.

## 7. UI and the mark

- **Profile list** (renderer.js:768-787):
  - Vendor rows go into `<optgroup label="AMD — not yet tested on real hardware">` and the same for Intel, after the ordinary options.
  - Option text is `H265 · AMD ⚠`, with `— unavailable` added when disabled (as at :772-773).
  - With no `vendorProfiles`, nothing is added, so ui-workbench.test.cjs:155-163 keeps `options.length === 1`.
- **The mark, shown when a vendor profile is selected:**
  - `<details id="profile-untested" class="control-help">` in the profile label line (index.html:51), using the ⓘ help pattern.
  - Its summary is ⚠, with `title` and `aria-label` set to: "Not yet tested on real AMD/Intel hardware. Results are checked after encoding."
  - The help panel adds:
    - AMD: "The app cannot confirm which encoder settings AMD actually used."
    - Intel: "The app cannot prove which Intel adapter encoded the file."
- **Colour.** The mark uses the existing `--warning-text` and `--warning-accent` tokens in all three theme blocks (styles.css:50-51, 153-154, 253-254). No new token and no palette change.
- **Other text:**
  - The Tested Default button reads "Starting values".
  - `#quality-hint` names QP or ICQ.
  - Capability rows name the adapter and show partial support: "8-bit only on this computer — 10-bit: ⟨reason⟩".
  - Vendor result rows carry the mark.
  - The `#vendor-beta-note` text (index.html:66) is rewritten, because "not selectable here" becomes false. The Beta labels stay. No test pins this text.
  - All text is set with `textContent`.

## 8. Security

**Trust boundaries:**
- **Renderer to main.** Only `{profileId, preset, quality}` crosses, on the existing channels (ipc.cjs:28, 43). There is no device, mode or option field.
- **Child processes.** Argv arrays only, with no shell. ffmpeg and ffprobe output is untrusted and bounded (capabilities.cjs:11).
- **DXGI rows.** Only validated rows are used (windows-adapters.cjs:114-136).
- **What stays main-only.** LUID, UMD and the binding. The adapter index is visible only as inert display argv (encoder-service.cjs:636-637).

| Guard | Code | Negative tests |
|---|---|---|
| Closed catalog; native or unknown id refused | `INVALID_SETTINGS` | `h265-amf`, `__proto__`, extra `mode`/`deviceId` key, accessor, Proxy; vendor id with `recipeId`; vendor id on the native path |
| Preset and quality from the table | `INVALID_SETTINGS` | AMD preset on Intel; QP 256; ICQ 0; float; string |
| Binding brand, vendor match, CPU/NVIDIA exclusion | `VENDOR_DEVICE_*` | plain look-alike object; AMD binding on Intel; binding on `h264-cpu` |
| Index is an integer 0–63 | `VENDOR_DEVICE_INVALID` | `"0,child_device=…"`, -1, 64, `"1"`, NaN from a fake helper |
| Pixel formats | `UNSUPPORTED_PIXEL_FORMAT` | yuv422p, yuvj420p, gray, yuv444p10le, nv12 |
| Depth, HDR, routes | `VENDOR_DEPTH_NOT_OFFERED`, `VENDOR_HDR_DEFERRED`, `VENDOR_ROUTE_UNQUALIFIED` | 10-bit H.264; HDR source; range, resize, FLAC, omission, preservation |
| Overlay shape | `VENDOR_ARGV_SHAPE` | mutated twin argv; duplicated `-i`; changed prefix |
| Startup containment and budget | `VENDOR_CHECK_*` | fake `SPAWN_FAILED`, hang and crash: the six CPU/NVIDIA results stay deep-equal; no stderr or path in the renderer projection |
| Output tag and count | `VENDOR_ENCODER_TAG_MISMATCH`, `VENDOR_FRAME_COUNT_MISMATCH`, `VENDOR_OUTPUT_DECODE_FAILED` | output tagged `libx265`; counts off by one; no `progress=end`; nothing published |
| Device recheck | `VENDOR_DEVICE_CHANGED` | LUID swapped at the same index before spawn, and between encode and publish |
| Tampering | `INVALID_PLAN` | `argsHash` recomputed at Start differs |
| Fixed text | `VENDOR_ENCODE_FAILED` | errno or path never reaches `item.reason` or `state.error` |
| Preferences | invalid → defaults | vendor key in the main file is still a schema error; forged vendor file with an accessor or unknown id |
| Isolation | — | spies: no call into native backend services, discovery, registry or native-file modules; `policyCount` stays 0 |

## 9. Test plan and the byte-identity proof

- **Commit 0, on unmodified HEAD.** `scripts/capture-ordinary-argv.cjs` writes `tests/fixtures/ordinary-argv-golden.json`. It covers:
  - six profiles × every preset × min, max and default quality × source formats (yuv420p, nv12, yuv420p10le, p010le, yuv444p for CPU) × metadata, attachment and subtitle cases, plus Archive;
  - `planFingerprint`/`expectedOutput`;
  - `describeRecipe`;
  - `defaultPreferences()`;
  - the fake-run argv sequence of `checkCapabilities`.

  `tests/vendor-baseline.test.cjs` asserts deep equality with that fixture. It also checks the SHA-256 of the four protected files against the `253c567` values.
- **`getCapabilities` stays the same.** With `vendorCapabilities: null`, it is deep-equal to the pre-change result. With fakes and no vendor adapter, only `vendorProfiles` is added.
- **Existing pins pass unedited:**
  - encode-operation.test.cjs:64-78;
  - NS-18 (native-file-service.test.cjs:213-229);
  - recipe.test.cjs and media.test.cjs:70-85;
  - capabilities.test.cjs:71 and :77-78;
  - preferences.test.cjs:34;
  - ui-workbench.test.cjs:155-163.
- **Proof that no test was edited.** `git diff --name-status 8d8b510 -- tests/` must show only `A` lines.
- **Cross-check.** The vendor fragments must equal the `nativeEncoderContribution` output per profile and depth.
- **All fakes.** Vendor tests use an injected `run` and `adapters`. Each slice gets an `/evidence-run` receipt with `--covers` the four protected files, then a final `npm test`.

## 10. Step plan (five Codex slices; root reviews and commits each)

0. **Root, read-only.**
   - Confirm in the n9.0.1 source that fftools takes `hw_frames_ctx` from the hwupload output for AMF and QSV (`hw_device_setup_for_encode`), and how `-filter_hw_device` behaves.
   - Capture and commit the golden fixture and the baseline test.
1. **Pure catalog and overlay:** `vendor-profiles.cjs`, `encoder-catalog.cjs`, `vendor-encode.cjs`, with their tests. No existing file is touched.
2. **Startup check:**
   - `vendor-capabilities.cjs`;
   - the capabilities.cjs export line;
   - the `#getCapabilities` seam and constructor option;
   - main.js composition;
   - tests.
3. **Preparation, provenance and preferences:** the encoder-service catalog seams and vendor branch, provenance.cjs, preferences.cjs, with tests.
4. **Execution:**
   - the spawn and publish rechecks;
   - the :1784 swap;
   - `vendorOutputCheck`;
   - the source count;
   - tests for success, decode failure, count mismatch, tag mismatch, device change and cancel.
5. **UI:** renderer.js, index.html, styles.css and `ui-vendor` tests. Root then runs `test:layout` and `test:product`, and writes the record and Ahmed's hardware checklist.
   - The checklist covers one vendor at a time: 8-bit and 10-bit, Full and KeepSource.
   - It includes one run with `-loglevel verbose` to confirm which device the encoder used.

## 11. Open risks

1. **Upload binding is unproven on hardware.** It is the reviewed native syntax, but has never run. Software frames with implicit device pickup is the fallback, but only after Ahmed's hardware test.
2. **AMF settings readback.** B-AMF-PRODUCER remains.
3. **QSV ICQ and low-power support vary by generation.** The startup check catches initialisation failures and known warnings, not silent mode substitution.
4. **Adapter identity.** There is a window between the DXGI recheck and ffmpeg's own enumeration (L-IDENTITY-ASSURANCE). A dock or undock can reorder adapters; the rechecks fail closed.
5. **False refusals from the frame count** are possible for field-coded or packed-bitstream sources. They fail closed.
6. **Extra time:**
   - the full decode, plus `-count_packets` when `nb_frames` is absent;
   - startup on machines with an Intel iGPU or AMD adapter (up to 5 small encodes per adapter tried, with a 90 s budget per vendor).
7. **Overlay coupling.** Any future change to the CPU builder greys vendors out. This fails closed and is pinned by test.
8. **The 320×180 startup check** proves nothing about 4K/8K, levels or other presets.
9. **0.6 compatibility.** 0.6 shows vendor descriptions as unavailable and ignores the vendor preferences file.
10. **Version labels.** The binary is 9.0.1. CLAUDE.md and operation-runtime.cjs:184 say 9.0.2. The records should be reconciled. The code label is not changed here, because NVIDIA environment identity uses it.

## Decisions: owner (Ahmed) versus root

**Owner (Ahmed):**
- O1. Accept this design as the revision of record 37 (milestone gate).
- O2. Acknowledge the record 37 invariant 3 scope note: the Beta rule covers the native path only.
- O3. The nv12/p010le-source limit: keep it (no protected-file change), or allow one additive media.cjs change later.
- O4. Keep the full strict decode on every vendor output, or accept a cheaper packet-count-only variant.
- O5. Whether NVIDIA later gets the same tag and frame-count checks. That would change NVIDIA behaviour, so it is not in this design.
- O6. Real-hardware testing, and the `VENDOR_TESTED_EVIDENCE` rows that remove the mark.
- O7. Any scope expansion: changed routes for vendors (these need measured families), vendor HDR (P05–P09 stays deferred), or a manual device choice.
- O8. The existing AMF same-component producer gate. It is unchanged; B-AMF-PRODUCER stays disclosed.
- O9. Acknowledge the new-suffix admission change listed below.
- O10. Milestone and product acceptance.

**Root:**
- The twin overlay architecture.
- Upload binding, and the order of fallbacks.
- Ids, labels, suffixes and the separation from native ids.
- Presets, ranges and start values taken from `NATIVE_PROFILES`.
- CQP for AMD and Intel AV1, ICQ for Intel H.264/HEVC. Ahmed may overrule this.
- Error codes and fixed message text.
- The mark's look: record 43 gives this to root.
- The separate `vendor-preferences.json` and the version-3 description.
- The encoder tag, the three-way count and the recheck points.
- Time budgets, the try-4-adapters order, slice order and Codex briefs.
- Reconciling 9.0.1 against 9.0.2 in the records.

## Changes to CPU/NVIDIA behaviour

- **What CPU/NVIDIA encodes does not change.** This covers prepared argv, `PROFILES`, defaults, Archive CQ29, the `profiles`/`recipes` capability results, v1/v2 description validation, the main preferences shape and output validation. The golden fixture and file hashes prove it.
- **One intended admission change (O9).** An unmarked input file whose name ends in a new vendor suffix becomes "Possible previous output" and is excluded unless overridden (encoder-service.cjs:812-822). Before, it was admitted as original. This affects only those filenames.
- **Side effects that change no output:**
  - startup runs one more DXGI helper, plus vendor encodes only when AMD/Intel adapters exist;
  - the main preferences file may hold a vendor `profileId`;
  - the profile list gains vendor optgroups;
  - the `#vendor-beta-note` text changes.

## 12. Review amendments (binding; root, November 12, 2026)

From Codex review `amd-intel-design-review`. Each amendment replaces the design text it names.

**A1 — The overlay validates the whole argv (high).** The shape checks in §4 also run on the twin argv as a whole, before any overlay:
- exactly one `-i`, exactly one output path and the exact terminal block `-default_mode passthrough -f matroska <out>`;
- no `-init_hw_device`, `-filter_hw_device`, `-hwaccel*`, `-filter*`, `-vf`, `-filter_complex` or `-filter_script*` anywhere in the twin argv;
- every token outside the replaced runs matches the accepted builder's grammar (media.cjs:362-426), or the result is `VENDOR_ARGV_SHAPE`.

The overlay then inserts the only device and filter options. Negative tests:
- extra device selectors (`-init_hw_device d3d11va=foreign:1 -filter_hw_device foreign`) placed before the output;
- a duplicate `-filter:v:0`;
- a second output;
- a changed terminal block.

**A2 — The runtime is 9.0.2 (medium).**
- The application runtime is the verified candidate FFmpeg 9.0.2: main.js:159-180 and src/candidate-runtime.cjs:13-35 pin it, and its expected SHA-256 begins `589e50b7`.
- The 9.0.1 binary the design read is the legacy runtime, so §11 risk 10 and the version notes in the preamble are withdrawn. CLAUDE.md's 9.0.2 is correct.
- The six wrapper help tables match between the two versions.
- Step 0's source check targets 9.0.2.
- **What stays unproven:** no FFmpeg source is available locally, so the `hw_frames_ctx` hand-off from `hwupload` into AMF/QSV (`hw_device_setup_for_encode`) is not proven. It stays open risk 1 until Ahmed's hardware test. The fallback (software frames with implicit device pickup) is decided after that test. No runtime pin changes.

**A3 — The frame-count claim is narrowed (medium).**
- A declared `nb_frames` is untrusted, so it is not an independent source count.
- The check becomes: the encoder's final progress `frame=` must equal the strict-decode count of the output. A declared source `nb_frames`, when present, must also agree, but any disagreement only fails closed and is never taken as proof.
- What is claimed: "the published file decodes completely and holds every frame the encoder produced". It does not claim "every source frame".
- A complete strict decode of the source, bound to the selected stream and the current source identity, would prove more but doubles the decode time. It joins owner decision O4.
- Tests: a dishonest header (declared 100, actual 101) fails closed; packet and frame mismatch cases.

**A4 — No startable vendor entry before the execution guards (medium).**
- Slice 3 may prepare vendor entries, but Start refuses them with `VENDOR_EXECUTION_UNAVAILABLE` (fixed text) until slice 4 lands the spawn and publish rechecks, the verifier swap and `vendorOutputCheck`.
- Slice 4 removes the refusal in the same commit.
- A test proves the intermediate refusal through the existing Start API with fakes.

**A5 — Decode budgets (medium).**
- The strict decode of the output, and any source count, run with an explicit budget: `max(120 s, 3 × the source duration)`, capped at 6 hours. They never inherit `runTool`'s 30 s default (process-runner.cjs:94).
- They take the job's abort signal, and cancellation settles the child before the item ends.
- If the budget runs out, the result is `VENDOR_VALIDATION_TIMEOUT` and the output stays unpublished.
- Fake tests cover validation longer than 30 s, budget exhaustion and cancellation.

**A6 — Test baseline (low).** The golden fixture and the "tests are only added" proof use `f8fc2df` as the implementation baseline. Its three test files changed by the security fixes are pre-existing.

**A7 — Owner versus root (low).** Vendor changed routes (range, resize, audio transform, omission) are already inside record 43's direction, which says Q's workflows apply to every encoder. They need measured families, a technical prerequisite that root schedules in Q; they are not a new owner scope. O7 therefore keeps only vendor HDR (still deferred) and a manual device choice.

## 13. Proposed source-contract amendment, November 21, 2026

Ahmed authorized repairing the existing ordinary vendor route while preserving the strict command guard. This proposed amendment supersedes only the global-copy spelling in §4 item 2 and its example, when independently reviewed and integrated. The historic example and golden capture stay as records of their original base, not a second supported grammar.

For the existing Windows-backed Full / Keep Source compatibility path only, main's current ordinary builder supplies one explicit primary-video encoder option directly after metadata/chapter mapping. Each already mapped audio, subtitle or attachment gets exactly one explicit copy decision, in map order, with its own output-kind ordinal. There is no global copy default and no fallback to the historical form. The vendor overlay preserves the main-selected stream order and copy options exactly, substituting only the already reviewed encoder, its settings, pixel block and device arguments.

Only private evidence built from the inspected source and current ordinary builder can bind a twin command. The shape check still consumes the complete command (including paths, metadata, dispositions, pixel/timing and provenance) and verifies the exact expected tokens and lengths. It refuses reordering, missing or additional codec decisions, or mismatched command/inspection evidence. No command, device choice or new option crosses from renderer to main.

This is not a new supported route, catalog row, format, driver, Linux vendor feature, hardware qualification or release. The ordinary CPU/NVIDIA builder and golden archive do not change; neither do device discovery, run/publish checks, output identity, the untested marker, the independent review gate or Ahmed's deferred physical acceptance.
