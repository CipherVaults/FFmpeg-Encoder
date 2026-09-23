> September24: [Decision17](17_Archive_Quality_Field_Decision.md) supersedes this document's preferred CQ32 starting point with CQ29 after Ahmed's field feedback. The measurements and historical decision below remain unchanged and valid for their original scope.

# Decision — HEVC Archive Quality starting recipe

Date: September20,2026. Human product authority: Ahmed. Mother Thread / strategic review: ChatGPT — GPT-5.6 Sol / Jerry. Engineering executor: Codex — GPT-6 Astra — Ultra effort, autonomous execution. Authority: binding September19 amendment14. This engineering selection does not itself accept L/M or establish subjective equivalence.

## Selected recipe and rationale

Use HEVC NVENC P7, UHQ, full-resolution multipass, VBR-CQ32, zero average bitrate, four B frames and B-reference mode each. Preserve source bit depth under the existing SDR policy. This is one transparent, editable helper; all six Tested Defaults remain unchanged. CQ24 and23 were benchmark starting hypotheses, not fixed requirements. The amendment explicitly permits a more defensible value based on evidence.

CQ32 is the best measured size/quality compromise among the bounded candidates23/24/28/30/32. Across three equal-duration clips it uses19,886,178bytes versus18,261,674 for the actual app x265 reference (+8.9%), with total measured encode18.192s versus93.344s (5.13x faster). This aggregate must not conceal scene variation: dark/menu is35% larger, town is4% smaller with somewhat lower metrics, and corridor/combat is8% larger with slightly higher metrics. No universal10% bound, mathematical quality equivalence, or best-possible claim is supported.

The CPU reference is libx265 slow CRF25 with the app's existing aq-mode=3:psy-rd=2. A separate stock-x265 town comparison confirmed that omitting those options changes both size and quality; it is not substituted for the product reference.

| Clip | x265 bytes | CQ32 bytes | Size ratio | x265 / CQ32 seconds | x265 / CQ32 VMAF mean | x265 / CQ32 VMAF P5 | x265 / CQ32 SSIM |
|---|---:|---:|---:|---:|---:|---:|---:|
| Town detail |8,322,353|8,007,056|0.962|35.024 /6.183|92.506 /91.119|86.014 /83.536|.968087 /.964917|
| Dark/menu |4,292,919|5,796,455|1.350|24.235 /6.031|94.617 /94.562|90.498 /89.888|.970995 /.976293|
| Corridor/combat |5,646,402|6,082,667|1.077|34.085 /5.978|97.603 /98.125|93.827 /94.820|.974904 /.977278|

CQ24 produced1.89x/3.30x/2.81x the x265 sizes and higher metrics. CQ23 increased size further for negligible metric/still benefit. CQ28/30 reduced size materially but remained above the desired aggregate neighborhood (CQ30 individually1.24x/1.74x/1.40x). CQ32 is a practical starting point, not an optimization proof or a promise for an entire archive.

## Method and visual limits

Pinned FFmpeg9.0.1, RTX5060 Blackwell driver616.92; no runtime/driver upgrade. Three8-second1080p60 8-bitBT709 clips (480frames each) from two completed read-only personal recordings. Every candidate used the same lossless FFV1 reference with no scaling or changed color/depth. Convergence reused those owned references; it did not reread originals or repeat earlier successful encodes. Full decode, frame count, geometry/color and aligned per-frame VMAF/SSIM passed. Source identities, runtime hashes, exactargv and all outputs/logs are in the evidence files below.

Parent inspected original-size same-frame PNGs on September20: town reference/x265/CQ32 show readable HUD and preserved coarse stone/door detail, with fine-texture differences; dark/menu CQ32 retains a different grain/texture balance from x265 while text stays legible; corridor/combat stills remain close in visible geometry, text and surfaces. This supports the bounded starting-point judgment, not temporal subjective equivalence. No human viewing study or continuous-motion subjective comparison was performed. Motion coverage is supported by complete per-frame metrics/decode; still inspection cannot prove absence of every temporal artifact. Ten-bit capability/endpoint evidence is distinct from representative10-bit gameplay quality evidence.

## Capability and interpretation

The reusable recipe gate now uses96-frame samples at8/10bit, full decode, exact output properties, complete valid I/P/B picture evidence and an observed run of four B frames. Ordinary profile checks remain two frames. Unexpected option warnings reject the recipe. Only the exact known diagnostic for global stream-copy deliberately overridden by hevc_nvenc is exempted. Picture types do not prove the entire reference-picture graph; accepted runtime options, vendor support and observed behavior form separate evidence.

Ada HEVC UHQ is vendor-documented and runtime-gated, but this machine supplies no Ada benchmark or performance proof. A shared helper is appropriate subject to that visible limitation. No other GPU-generation recipes are introduced. Existing defaults and saved manual settings do not change merely because the helper's chosen starting CQ changes.

## Durable evidence and references

- artifacts/archive-quality-1789838337640-a45fc8/report.json: completed original23/24, product/stock CPU comparisons and96-frame option checks; finished2026-09-19T17:28:06.394Z.
- Same directory convergence.json: completed28/30/32; finished2026-09-20T08:37:31.358Z. Do not rerun either completed campaign on re-entry. The earlier partial EVIDENCE.md predates finalCQ32 selection; this decision supersedes its pending-choice paragraph.
- scripts/archive-quality-benchmark.cjs reproduces bounded phases. Timings include startup and FFV1 decode. Initial x265 case observed external encoder utilization; townCQ28 may overlap a brief direct suite. These are same-machine measurements, not universal throughput guarantees.
- [NVIDIA SDK13.1 FFmpeg guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html): archiving recipe/options; internal fullres multipass is not a second whole-file job.
- [NVIDIA Blackwell SDK13.0 article](https://developer.nvidia.com/blog/nvidia-video-codec-sdk-13-0-powered-by-nvidia-blackwell/): HEVC UHQ support on Ada/Blackwell and generation differences.
- [FFmpeg n9.0.1 NVENC source](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.1/libavcodec/nvenc.c): CQ is passed as8.8 targetQuality and average bitrate/VBV are cleared unless explicitly bounded. Runtime logs corroborate requested CQ values; the23/24 plateau is not evidence that CQ was ignored.

Actual Archive app preservation/provenance/argv evidence and final packaged Blackwell acceptance are separate gates. See the L/M execution reports when complete. The accepted local-v0.5.0 artifact remains unchanged.
