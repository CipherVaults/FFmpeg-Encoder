# AMD and Intel as first-class encoders — owner decision, November 1, 2026

**Owner:** Ahmed. **Writer:** Claude (root). This record answers [record 42](42_P_Closure_Record_2026-11-01.md) §6, decisions D1, D2, D3 and D5 and the logo, and changes the plan for milestone P. It supersedes record 38 §8's recommendations for those decisions. Where record 35 or record 37 say a production policy needs genuine vendor evidence before AMD/Intel can run, this decision replaces that gate for the "untested" tier described below.

## 1. Ahmed's words (November 1, 2026, ~10:30 Cairo)

- "we need to be preparing the AMD and Intel options as if they are there, similarly to how we done this for NVIDIA. And let's say if I took this program on another machine that does not have any NVIDIA encoders, it will be just grayed out, because the encoder check at the start of the program already makes sure with which encoders are available to be used. That's what I'm intending to use regarding AMD and Intel."
- "Even if I am developing this on a machine that does not have an Intel iGPU, for example, or encoder in general, nor do I have an AMD encoder as well at the moment, I can test this on later on a machine that have these type of encoders, possibly. Not every generation, yes, I admit that, but at least something."
- "it should not be limited to any specific encoder or setting or resolution only. That's very limiting. It should be offering the full spectrum of encoders and capabilities as much as possible, just as every other option, like as much as possible, like the CPU or NVIDIA encoders, if that's technically possible. If there is some technical reason that I don't know about that prohibits that, then there is that to be made clear, not to be limited"
- "we shouldn't make it as a second class citizen just because we do not have the hardware. We are developing it as much as possible without the hardware, and I will be able to then test it hopefully one day at a machine that have these hardware. Either our development and code works or not, then if not, I will try to give you the issue and we will try to fix it then and there."
- "we can make some sort of an I label beside the option somewhere in the UI, which I will leave that choice to you. When the user is choosing that, or a warning, perhaps logo rather than an I, regarding the honesty that we didn't possibly test this at a real hardware, and we can then only update this when once we have actually tested it on real hardware and managed to confirm that it's working just fine."
- "As for the logo, I have a gut feeling that we can let Codex design it once more, because the logos that I've seen as of now, it's not suitable at all for the design and theme of the language of the app. And we'll have to see later, it's not urgent right now."
- "it's okay to exceed the weekly quota just to check this answer and record it and reply back if anything is needed, because it's relevant to the establishment of where we stop."

## 2. What each open decision becomes

| # | Was (record 42 §6) | Now |
|---|---|---|
| D2 (C5–C6) | Not scheduled while policies are `[]` | **Build the window channel and the UI.** AMD and Intel appear as encoder options like NVIDIA. The startup encoder check greys out what a machine lacks, per codec and bit depth. |
| D3 | Finite H.264 8-bit 720p file route | **The full spectrum that is technically possible:** H.264, HEVC and AV1, 8 and 10 bit, any resolution, Full and KeepSource, with the same options as CPU and NVIDIA. Each limit must have a stated technical reason (§3). |
| D5 | Hardware campaign, or ship unverified | **Ship with an honest "not tested on real hardware" mark beside AMD and Intel.** Ahmed tests later on real hardware when he can. A confirmed machine or generation then loses the mark. |
| D1 | AMF "specifically unavailable" | **AMD is offered too, with the same mark.** The mark also says that the app cannot confirm the encoder settings AMD actually used (§3). |
| Logo | Pick an R07 candidate | **None of the current candidates.** Codex designs new ones later, in the app's own design language. Not urgent. |
| D6, D7 | Decide at S | Unchanged: decide at S. |

The mark's design is root's choice, per Ahmed. Root's plan is a small amber warning symbol beside the AMD and Intel options, with a one-line tooltip: "Not yet tested on real AMD/Intel hardware. Results are checked after encoding."

## 3. Technical facts Ahmed asked to have made clear

1. **Why today's path cannot run anywhere.** C1–C4 publish an AMD/Intel file only when it matches a reference made beforehand on real hardware, and they run only for policies made from qualified evidence. With no hardware, none exist, so the path can never run. To meet this decision, AMD and Intel outputs are checked the way NVIDIA outputs are checked today: the app probes the finished file (codec, size, frame count, duration and the other ordinary checks) before saving it. The exact-reference machinery becomes the later "tested" tier, the evidence that removes the mark.
2. **AMD's settings readback.** The pinned FFmpeg cannot report which rate-control settings AMD's encoder actually applied (B-AMF-PRODUCER). The output is still checked, but the requested settings are not proven. The AMD mark says so.
3. **Generation limits.** Each GPU generation supports a different set: for example, AV1 encoding needs recent GPUs, and 10-bit support varies. The app does not hard-code these. The startup check reports what each machine's encoder accepts, and anything missing is greyed out with its reason.
4. **HDR.** HDR on AMD/Intel follows HDR's existing deferral: experimental and not expanded (P05–P09).
5. **Intel device identity** (L-IDENTITY-ASSURANCE). The app cannot prove which Intel adapter session encoded a file. This stays disclosed.

## 4. Plan consequence

- Milestone P reopens for this scope. P01–P03 stay PARTIAL until the new work is done.
- **Order:**
  1. Friday, November 6, after Claude's weekly reset: the security scans, as Ahmed set them.
  2. A reviewed design for AMD and Intel as first-class encoders, on the ordinary operation pipeline. This revises record 37.
  3. The implementation, Codex-heavy.
  4. Q.
  Building AMD/Intel on the ordinary pipeline first means Q's media workflows then apply to every encoder.
- **Unchanged:**
  - ordinary CPU/NVIDIA defaults and Archive CQ29;
  - accepted 0.5/0.6;
  - the benchmark;
  - HDR's deferral;
  - packaging last;
  - every hard limit in CLAUDE.md.

## 5. What remains open

- D6 and D7, at S. Nothing is needed now.
- The logo, later (Codex).
- Nothing else is blocking. The mark's exact look is root's choice and goes into the design step.
