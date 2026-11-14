# 46 — AMD/Intel hardware checklist and owner points (November 12, 2026)

**Status:** root-written, for Ahmed.
- It is the hardware checklist that [record 45](45_AMD_Intel_First_Class_Design_2026-11-12.md) §10 slice 5 asks for.
- It also gives record 45's ten owner points (O1–O10) in plain words.
- **Nothing here is decided until Ahmed answers.**
- Writer: Claude (root).
- A four-lens review checked it against the code, upstream FFmpeg source and the project limits before commit (workflow `wf_cce08f7a-a68`).

**Owner answers:**
- **H1, November 12, 2026: "C: wait for packaging"** (Ahmed, verbatim).
  - No portable test copy is built now, and hardware testing waits for packaging, which comes last (record 35).
  - AMD/Intel stay marked "not yet tested" until then.
- O1–O10 are still open.

**Where the work stands:**
- The six AMD/Intel choices are built and tested with simulated hardware [fakes]. CPU and NVIDIA encodes are proven unchanged [byte-identical].
- The desktop smoke tests pass, and the ⚠ mark was checked in both themes (commit `50c1bcd`).
- **They have never run on a real AMD or Intel graphics chip.** This computer has neither: a Ryzen 5 5600X with no built-in graphics, and a GeForce RTX 5060. So the startup check greys all six out here, as designed.

---

## Part 1 — The hardware checklist

### 1.1 What you need

**A Windows computer of your own with an AMD Radeon or Intel graphics chip.** A graphics card or a processor's built-in graphics both count.
- Install the current graphics driver first, and do not update it during the tests.
- What each chip generation can do:

  | Encoding | Needs at least |
  |---|---|
  | AV1 | AMD Radeon RX 7000 or RX 9000 cards, or Radeon 780M/760M built-in graphics; Intel Arc cards, or a Core Ultra processor's built-in graphics |
  | H.265 10-bit | Most AMD and Intel chips from about 2016–2017 onward |

- Chips that look suitable but cannot do AV1:
  - Ryzen 7000/9000 desktop built-in "Radeon Graphics";
  - RX 6000 cards.
- Intel processors whose names end in "F" have no built-in graphics at all.
- **Expect some choices to grey out on older chips,** with a reason. That is the designed behaviour and a useful result.
- **A known AMD limit.** RX 7000 and Radeon 780M/760M make AV1 video a few lines taller, for example 1080 becomes 1082. This is a hardware limit AMD has documented (FFmpeg ticket #10266). The app refuses any change of picture size, so on those chips AMD AV1 may grey out at startup or fail with "Video resolution changed". Record it as a hardware result, not a mistake.

**The app on that computer.** This working folder cannot just be copied: it needs developer tools to start and holds private records. See decision **H1** in 1.2.

**Two short test clips,** each 10 to 60 seconds. The app only reads them; it never changes them.
- **An 8-bit clip.** A ShadowPlay or OBS screen recording that is not HDR is the safest choice.
- **A 10-bit clip that is not HDR.** Most 10-bit phone clips are HDR, which is refused on purpose. If you have no 10-bit SDR clip, ask root to make one from an 8-bit clip.
- Some clips do not suit this test, and that is not a failure of the chip. If one of these messages appears at Prepare, before you change anything, pick another clip and note which one:
  - "Vendor encoding supports planar 4:2:0 8-bit or 10-bit source pixels only." Common for full-range phone video and 4:2:2 or 4:4:4 camera files [yuvj420p, yuv422p, yuv444p, nv12/p010le].
  - "The source color evidence is unsupported or incomplete."
  - "This vendor profile currently supports Full and Keep Source with copied streams only." This one shows up, for example, on camera files that carry a timecode track.

**Folders:** all new, and none of them a personal media folder.

| Folder | Holds |
|---|---|
| `input-8bit` | the 8-bit clip only, copied in, not moved |
| `input-10bit` | the 10-bit clip only |
| `input-hdr` | optional: one HDR clip |
| `out-amd` / `out-intel` | empty at the start; one per vendor |

- The app takes every MP4, MKV, MOV, AVI or WebM sitting directly in the input folder, so keep one clip per input folder.
- **On this computer,** if you ever add an AMD or Intel card, create all of these inside `F:\shadow play\FFmpeg Encoder Tests\`. Record 40 allows new files only there under `F:\shadow play`.
- **On another computer,** any new folders on a local drive will do.

### 1.2 Decision before testing: getting the app onto the test computer (H1)

| Choice | What happens | Cost |
|---|---|---|
| **A. A test-only portable copy** (recommended) | Root builds the app's portable form (`npm run make:portable`) for the first time on 0.7. It is written only into the project's own `out\` folder, with no download, no publishing and no Git change. The existing portable check (`npm run test:portable`) is written for 0.6, so root first adapts a 0.7 check: a reviewed, tested code change. Root then confirms on this computer that the copy starts, verifies its FFmpeg 9.0.2 and runs one CPU and one NVIDIA job. You copy the ZIP over. | It touches packaging, which record 35 puts last, so it needs your word. It is **not** packaging acceptance. |
| **B. A developer copy** | The test computer gets a checkout of the private repository plus the pinned Electron and FFmpeg 9.0.2, set up the way this computer was. | It needs Node, Git and repository access there, a manual copy of the pinned archives, and at least 27 GB free. The Electron setup script looks for this computer's `F:` folder, so it must be edited or run by hand. |
| **C. Wait** | Testing waits for packaging. | AMD/Intel stay "not yet tested" until then. |

**With choice A:**
- Copy the ZIP by USB drive.
- Extract all of it into a new folder on a local drive, for example `C:\FFmpegEncoderTest`. Not Program Files, a network drive, or a synced or redirected folder: the app keeps its data beside itself and refuses linked folders.
- Windows may warn that the app is unrecognised. It is unsigned, which is expected for a test copy.
- The bundled read-me is still the 0.6 text. Follow this checklist instead.
- **Use the copy only on your own computers.** Its FFmpeg is cleared for local use, not for distribution.

### 1.3 The runs, one vendor at a time

Finish every step for one vendor before starting the other, and keep separate notes for each. "Vendor" below means AMD or Intel. In the profile list, the choices sit under "AMD — not yet tested on real hardware" (or Intel), for example **H264 · AMD ⚠**.

**Step 1 — Startup.**
1. Open the app. Wait for the top-right badge to change from checking to **Ready**, which can take 1–3 minutes.
2. In Encode, open **Encoder availability and runtime**.
3. Note the three rows that start with **H264 · AMD ⚠**, **H265 · AMD ⚠** and **AV1 · AMD ⚠** (or Intel).
   - Ignore the rows lower down that start "AMD AMF — Beta" or "Intel Quick Sync — Beta". They belong to the separate "Native backend checks" lab and always look unavailable.
   - A working row ends "… 8 / 10-bit supported on this computer", or "8-bit only on this computer — 10-bit: <reason>", and names the chip.
   - A greyed row shows only its reason.
   - Note any extra line about "adjusted parameters" or "multiple matching adapters" [VENDOR_PARAMS_ADJUSTED, VENDOR_MULTIPLE_ADAPTERS].
4. Take a screenshot.
5. If all three rows are greyed, stop here for this vendor and send the screenshot.
6. If any message says "The checked vendor adapter or driver changed", restart the app.

**Step 2 — The runs.** Use the vendor's own output folder for all of them. Skip a run whose choice or depth Step 1 showed as greyed, and note "greyed out: <reason>".

| Run | Profile | Input folder | Expected after Prepare batch | Expected at the end |
|---|---|---|---|---|
| 1 | H264 · vendor | `input-8bit` | Ready | Succeeded: `<clip>_H264-AMD-GPU.mkv` (or `-Intel-GPU`) |
| 2 | H264 · vendor | `input-10bit` | **Unsupported:** "This vendor profile does not offer the source bit depth. H.264 is 8-bit only." | Nothing to start; a correct refusal |
| 3 | H265 · vendor | `input-8bit` | Ready, then follow the **extra steps** below before Start | Succeeded: `<clip>_H265-…-GPU.mkv` |
| 4 | H265 · vendor | `input-10bit` | Ready, 10-bit | Succeeded, 10-bit |
| 5 | AV1 · vendor | `input-8bit` | Ready | Succeeded: `<clip>_AV1-…-GPU.mkv` |
| 6 | AV1 · vendor | `input-10bit` | Ready, 10-bit | Succeeded, 10-bit |
| 7 (optional) | H265 · vendor | `input-hdr` | **Unsupported:** "HDR encoding on AMD and Intel is deferred." | Nothing to start; a correct refusal |

**How to do one run:**
1. Select the profile. The ⚠ mark should appear beside it, and the small button under the quality slider (normally "Tested Default") should read **Starting values**.
2. Keep the starting preset and quality.
3. Choose the input folder for the run and the vendor's output folder.
4. Press **Prepare batch**.
   - The file row shows Ready or Unsupported, with its size, frame rate and bit depth (for example "1920 × 1080 · 60 fps · 10-bit").
   - If the list looks empty, set Show to All.
5. Open **Processing defaults for this batch** and check that Resolution is "Keep source resolution" and Full-video audio is "Copy compatible audio". These are the defaults on a fresh install; if they differ, set them back in Settings first.
6. Press **Start selected files**. The app switches to Current Jobs.

**Extra steps in run 3, after Prepare batch and before Start:**
1. **A third refusal.** In Processing defaults for this batch, set Resolution to 720p and press **Apply changed batch defaults**.
   - The file should show **Unsupported:** "This vendor profile currently supports Full and Keep Source with copied streams only."
   - Set Resolution back to "Keep source resolution", press Apply changed batch defaults again, and check the file is Ready.
2. **Two values for Step 3.** Press **Inspect** on the file and open **Resolved FFmpeg arguments**. Write down:
   - the path after **Executable:**. This is the app's own FFmpeg;
   - the number **N** in the line `"d3d11va=ffenc_d3d:N"`, just after a line `"-init_hw_device"`. This is the chip the app chose.

   If you miss them, prepare run 3 again into a new, empty output folder. A finished run's output already exists, so a repeat shows "Output already exists" and offers no arguments.
3. Then press **Start selected files**.

**Note these for each run:**
- The status, **Succeeded** or **Failed**, with the exact message. A screenshot is fine.
- That the result row carries the ⚠ mark.
- "Batch elapsed" from Current Jobs, and roughly how long the **Validating output** stage took. O4 needs this.
- The output size, from File Explorer.
- Whether the file plays normally, with picture, sound and length matching the clip. If AV1 or 10-bit will not play, try VLC before calling it a failure, and note the player.

**A Succeeded file has already passed:**
- the app's ordinary checks: codec, picture size, bit depth, duration, copied audio and other streams, chapters;
- plus these AMD/Intel checks:
  - it decoded completely;
  - its decoded frame count equals the count the encoder reported, and the clip's declared count when it has one;
  - its encoder tag names the AMD/Intel encoder;
  - the chip found at startup was still the same at Start, before encoding and before saving;
  - the source did not change.

**If a 10-bit H265 or AV1 run shows the "H.264 is 8-bit only" message,** the chip failed its 10-bit startup check. That message always mentions H.264. Record it as greyed out.

### 1.4 Step 3 — one detailed run per vendor, to see which chip was used

The app does not show FFmpeg's detailed log, so this is one separate 10-second, video-only command. It uses the app's own FFmpeg with the same device and encoder settings as run 3. It writes only a log file and a short test video into the vendor's output folder.

1. Open PowerShell: Start menu → type "PowerShell".
2. Fill in the four values at the top of the block, then paste it whole. The block:
   - goes to the output folder;
   - stops if the files already exist;
   - checks that FFmpeg reports **9.0.2**;
   - runs the test;
   - clears the log setting afterwards.

**AMD:**

```powershell
$out  = "<the out-amd folder>"
$ff   = "<the Executable path from run 3>"
$clip = "<full path of the 8-bit clip>"
$n    = <N from run 3>
Set-Location -LiteralPath $out
if ((Test-Path verbose-amd.log) -or (Test-Path verbose-amd-h265.mkv)) { throw "Files exist already: use a new, empty folder." }
& $ff -version | Select-Object -First 1    # must say: ffmpeg version 9.0.2-full_build-www.gyan.dev
$env:FFREPORT = "file=verbose-amd.log:level=40"
& $ff -nostdin -n -init_hw_device "d3d11va=ffenc_d3d:$n" -filter_hw_device ffenc_d3d -i $clip -map 0:v:0 -t 10 -c:v:0 hevc_amf -quality:v:0 balanced -usage:v:0 transcoding -rc:v:0 cqp -b:v:0 0 -qp_i:v:0 24 -qp_p:v:0 24 -filter:v:0 "format=nv12,hwupload=extra_hw_frames=16" -profile:v:0 main -pix_fmt:v:0 d3d11 -bitdepth:v:0 8 -fps_mode:v:0 passthrough -f matroska verbose-amd-h265.mkv
Remove-Item Env:FFREPORT
```

**Intel:**

```powershell
$out  = "<the out-intel folder>"
$ff   = "<the Executable path from run 3>"
$clip = "<full path of the 8-bit clip>"
$n    = <N from run 3>
Set-Location -LiteralPath $out
if ((Test-Path verbose-intel.log) -or (Test-Path verbose-intel-h265.mkv)) { throw "Files exist already: use a new, empty folder." }
& $ff -version | Select-Object -First 1    # must say: ffmpeg version 9.0.2-full_build-www.gyan.dev
$env:FFREPORT = "file=verbose-intel.log:level=40"
& $ff -nostdin -n -init_hw_device "d3d11va=ffenc_d3d:$n" -init_hw_device "qsv=ffenc_qsv@ffenc_d3d" -filter_hw_device ffenc_qsv -i $clip -map 0:v:0 -t 10 -c:v:0 hevc_qsv -preset:v:0 medium -b:v:0 0 -global_quality:v:0 25 -filter:v:0 "format=nv12,hwupload=extra_hw_frames=16" -profile:v:0 main -pix_fmt:v:0 qsv -fps_mode:v:0 passthrough -f matroska verbose-intel-h265.mkv
Remove-Item Env:FFREPORT
```

3. **If the version line does not say 9.0.2, stop.** That is the wrong FFmpeg. Never use a top-level `ffmpeg\` folder in a developer copy: it is the older 9.0.1.
4. Open the log (`verbose-amd.log` or `verbose-intel.log`) in Notepad and search (Ctrl+F) for **Using device**. The line looks like:
   `[AVHWDeviceContext @ 000001…] Using device 1002:744c (AMD Radeon RX 7900 XTX).`
   - The first number is the maker: 1002 is AMD and 8086 is Intel.
   - The name in brackets is the chip. It must be the one you meant to test.
   - A line just before it should read `Selecting d3d11va adapter` with your N.
5. **If there is no "Using device" line, or the adapter number differs from N,** FFmpeg used Windows' default chip instead, and this run proves nothing. Note it and send the log anyway.
6. Also look for:
   - **AMD:** "AMF via D3D11" and "AMF initialisation succeeded via D3D11": AMF attached to that same chip. AMD does not print the settings it actually used, so its disclosure stays [B-AMF-PRODUCER].
   - **Intel:** "Initialize MFX session", the ICQ rate-control line, and "ICQQuality: 25". The Quick Sync session is tied to the chip named above, but no line names the chip directly, so the Intel disclosure stays accurate.
   - **Either:** any line with "partial acceleration" or "incompatible video parameters". Note it.

`-n` stops FFmpeg from replacing an existing video file. The log file would be replaced without warning, which is why the block checks first. Do not compare this short test file's size or frame count with the app's saved files: it is only 10 seconds, video only.

### 1.5 What to send back

For each vendor:
- how the app got there (H1: A or B);
- the chip name and driver version (Device Manager → Display adapters → the chip → Driver tab);
- the Windows version (Win+R, type `winver`);
- each clip's line from the file row (size, frame rate, bit depth), and any clip you had to replace, with its message;
- the Step 1 screenshot;
- the notes for runs 1–7 (status and message, times, size, player);
- a screenshot of any failure;
- the N value, the log file, and whether "Using device" named the intended chip.

**If something fails:**
- Normally the app saves nothing and shows a fixed message. Screenshot it.
- If the message says a copy "may exist" or "was retained without publication", do not use or delete that file. Just report it.
- A failure on real hardware is a useful result, not your mistake.
- One known risk is how frames are handed to the chip (record 45 §11 risk 1). Root has a prepared fallback, to be decided only after your results.

**The ⚠ mark afterwards.**
- Removing it needs your decision (O6) and a small later code change that reads the passed results [VENDOR_TESTED_EVIDENCE].
- It would apply only to the exact vendor, codec, bit depth, chip and driver that passed.
- AMD's note, "The app cannot confirm which encoder settings AMD actually used", stays even then.

---

## Part 2 — The ten owner points (record 45 O1–O10), in plain words

**Before hardware testing,** answer H1 and O6; O1 and O2 are worth answering at the same time. The rest can wait.

| # | Question | Root recommends | If you choose otherwise |
|---|---|---|---|
| **O1** | Do you accept the AMD/Intel design (record 45) as the revision of record 37's plan? Record 37's other rules and the "Native backend checks" lab stay as they are. | **Yes.** It is built, tested with simulated hardware, and CPU/NVIDIA are proven unchanged. | It stays built but formally unaccepted, and product acceptance (O10) cannot close. |
| **O2** | The old rule "Beta never enables Start" now covers only the "Native backend checks" lab in Settings. The new AMD/Intel choices can Start, with the ⚠ mark. OK? | **Yes.** That was the point of your November 1 decision (record 43). | AMD/Intel would have to hide behind Beta again. |
| **O3** | A rare way of storing video pixels, mostly from capture tools rather than phones or cameras, is refused for AMD/Intel [nv12/p010le]. Keep refusing it, or later allow a small addition to a file that is locked to keep CPU/NVIDIA unchanged [`src/media.cjs`]? | **Keep refusing it for now.** Revisit if a real clip of yours hits it. | One small addition, with its own proof that CPU/NVIDIA stay unchanged. |
| **O4** | Every AMD/Intel output is fully decoded before it is saved, which costs time. Keep that, use a cheaper count-only check, or use a stricter check that also decodes the original (proves no frame was lost, about twice the checking time)? | **Keep the full check** until the hardware timings are in. | Cheaper: faster saves, but damage is less likely to be caught. Stricter: more proof, slower saves. |
| **O5** | Should NVIDIA later get the same extra checks (encoder tag and frame count)? | **Not now.** It would change accepted NVIDIA behaviour. Reconsider after the AMD/Intel results. | A separate, later change to NVIDIA, with its own tests. |
| **O6** | Will you run the Part 1 tests? And afterwards, should the ⚠ mark come off only for exactly what passed (same vendor, codec, bit depth, chip and driver)? | **Yes to both.** The mark decision is taken from your results. | Without testing, the mark stays everywhere. |
| **O7** | Two possible additions remain [after review amendment A7]: AMD/Intel **HDR**, and a **manual choice of graphics chip**. Trim, resize, audio changes and leaving out streams for AMD/Intel are already in your direction, and root schedules them in the next work block [milestone Q] once measured. | **Not now.** HDR stays deferred with the other HDR work [P05–P09]; the app uses the first chip that passes. | Either becomes a new, scoped piece of work. |
| **O8** | The AMD "same-component producer" question is unchanged: the app still cannot confirm which settings AMD applied, and says so [B-AMF-PRODUCER]. | **Acknowledge it.** That keeps today's disclosure. It does not settle the AMD question, which stays your decision. | "Discuss later" changes nothing today. |
| **O9** | A file with no app record inside it, whose name ends like an AMD/Intel output (for example `_H265-AMD-GPU`), now shows "Possible previous output" and is left out unless you choose "Treat as original". Before, it counted as an original. Files the app really made are already recognised by their record, whatever their name. | **Accept.** It stops a copy of an app output that lost its record from being re-encoded as an original. | Such files are admitted as originals again. |
| **O10** | Milestone and product acceptance. | **Later,** after the hardware results and milestone Q. | — |

**Quick answer sheet** (one word each is enough):
- H1: A / B / C
- O1: yes / no
- O2: yes / no
- O3: keep / allow later
- O4: full / cheaper / stricter
- O5: not now / plan it
- O6: yes / no
- O7: not now / which one
- O8: acknowledged / discuss later
- O9: accept / reject
- O10: later

## Owner answers — November 14, 2026

Ahmed answered O1–O10 on November 14, 2026; his words and root's reading are in [record 47 section 10](47_Milestone_Q_Plan_2026-11-12.md). In short: O1 yes, O2 yes, O3 keep, O4 cheaper check as the default with a later comparison, O5 no, O6 the mark is only a label and hardware testing stays as decided, O7 not now (no HDR), O8 acknowledged (root's choice at Ahmed's request), O9 accept, O10 later.
