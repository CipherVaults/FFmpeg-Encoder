# September 19 binding product-owner amendment — exact Notion mirror

Source: https://app.notion.com/p/3e0bd7ade63b816ca2ede7e17f0fba1a?pvs=204

Title: 🧭 0.6 Product-Owner Amendment — Re-encoding, Transparency & Archive Quality NVENC

Fetched September 19, 2026. Source last edited: 2026-09-19T12:35:32.609Z. The complete fetched page content is preserved below, including enhanced Markdown. Authority comes from Ahmed's explicit instruction in this task to treat this page as binding. This supplements 11/12/13 and specifically supersedes 13's future-only exclusion for the HEVC Archive Quality Ada/Blackwell recipe. No other excluded scope is promoted.

Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3e0bd7ade63b816ca2ede7e17f0fba1a as of 2026-09-19T12:35:32.848Z:
<page url="https://app.notion.com/p/3e0bd7ade63b816ca2ede7e17f0fba1a" icon="🧭">
<ancestor-path>
<parent-page url="https://app.notion.com/p/3d2bd7ade63b8176a879fd8fccb4d5fe" title="FFmpeg Encoder Desktop App"/>
<ancestor-2-data-source url="collection://adc56439-d69c-4fce-b452-af0fb085f4e2" name="Projects & Ideas Registry"/>
<ancestor-3-database url="https://app.notion.com/p/d8eb25dc9ada4e59987c86feff5504e1" title="Projects & Ideas Registry"/>
<ancestor-4-page url="https://app.notion.com/p/3d2bd7ade63b818f9b81ec3076427097" title="🧭 Projects & Ideas Control Center"/>
</ancestor-path>
<properties>
{"title":"0.6 Product-Owner Amendment — Re-encoding, Transparency & Archive Quality NVENC"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🧭"}</iconMetadata>
<content>
<callout icon="🧭" color="blue_bg">
	**Purpose:** binding product-owner amendment for the active FFmpeg Encoder 0.6 Goal. Codex should read this page before resuming L/M. It consolidates the September 10–19 Mother Thread steering so Ahmed does not need to paste a large amendment into every quota window.
</callout>
**Human product authority:** Ahmed  
**Mother Thread / strategic continuity:** Jerry / ChatGPT  
**Engineering executor:** Codex / Astra, using the currently selected high-autonomy reasoning configuration  
**Amendment date:** September 19, 2026  
**Applies to:** the active 0.6 Goal after accepted J/K, especially L and M
<callout icon="⚠️" color="yellow_bg">
	**This page changes the definition of "L complete" and therefore the entry conditions for M.**
	Do not finish or accept the old L/M contract without incorporating this amendment.
</callout>
# 1. Re-entry instruction for Codex
Before implementing anything:
1. Read the current repository `AGENTS.md`, Current State, Continuation State, live Git status/log, the approved 0.6 Goal/Plan, and the newest relevant execution evidence.
2. Perform **Recovery Reconciliation** first. Preserve valid partial L work, surviving subagent work, tests and artifacts. Do not restart J/K and do not blindly restart L from documentation if live files are ahead.
3. Treat accepted J and K checkpoints as preserved boundaries unless this amendment reveals a specific regression that requires proportionate correction.
4. Persist this amendment into the project-local documentation as a dated binding addendum before final L/M acceptance so future autonomous wakes do not depend on Notion availability.
5. Re-plan only the delta necessary to satisfy this amendment. Then autonomously inspect → implement → test → review → recover → document → checkpoint.
6. **Do not enter final M acceptance or create/tag ****`local-v0.6.0`**** until every binding requirement below has either passed evidence-backed acceptance or has been explicitly narrowed by Ahmed.**
The recurring continuation/heartbeat may resume the amended Goal after quota resets. On each wake, Recovery-Reconcile first and continue the exact unfinished approved action. Never redeem manual reset credits automatically.
# 2. Preserved 0.6 baseline
The amendment does **not** invalidate the already accepted 0.6 foundation:
- J — persistent inspection reuse / fast warm preparation: accepted.
- K — safe same-folder originals + generated outputs, provenance and safe publication: accepted at checkpoint `3654c36`.
- L — remembered workflow + compact UI + Tested Default/help: active/in-progress and may contain valid unfinished work.
- M — final portable 0.6 acceptance: still gated behind the amended L contract.
The accepted `local-v0.5.0` release remains immutable/recoverable.
# 3. Product principle
The application is designed for Ahmed first and similar technically curious users second.
Preserve this rule:
> **Advanced controls first; assistance and explanation second.**
The application should protect the user from accidental destructive or recursive behavior, while still allowing deliberate expert choices.
The application should also avoid becoming a black box:
> **Ahmed should not need to inspect source code merely to understand what FFmpeg is actually being told to do.**
# 4. Binding addition A — intentional re-encoding of generated outputs
K's default behavior remains correct:
- FFmpeg Encoder-generated outputs are recognized.
- They are excluded from ordinary source admission by default.
- Same-folder rescans must not recursively encode generated outputs.
- Existing no-overwrite, provenance, publication, cleanup and source-reservation protections remain intact.
However, Ahmed may intentionally want to encode a generated output again using:
- another codec;
- another hardware/backend;
- another preset;
- another CRF/CQ;
- a more compression-efficient recipe;
- or another experiment/compatibility target.
Therefore the product must distinguish accidental recursion from deliberate re-encoding.
The desired model is:
```plain text
Generated output
→ excluded by default
→ clearly identified in Batch Preview
→ user explicitly authorizes this exact file
→ file becomes an intentional source for the current prepared state
→ normal codec/backend/preset/quality controls apply
→ new output receives normal provenance
→ later rescans exclude it again by default
```
Do **not** add a global "ignore provenance" or "allow all generated outputs" switch.
## Treat as original vs Re-encode this output
Keep these semantically separate:
- **Treat as original** = an ambiguous/unmarked legacy file looks like a previous output, but the user says that classification is wrong.
- **Re-encode this output** = provenance is correct; the user intentionally wants another generation.
A confidently recognized generated output should have an explicit action such as **Re-encode this output** or equivalent polished wording.
Authorization must:
- apply only to explicitly selected file(s);
- bind to the exact current file identity/prepared state;
- invalidate if the file is replaced or meaningfully changes;
- not silently authorize unrelated generated outputs;
- not become a permanent provenance bypass;
- not silently persist across unrelated preparations/restarts unless separately justified;
- preserve destination collision protection, source protection, cancellation, cleanup and publication guarantees.
# 5. Generated-output UX in Batch Preview
Do not implement the re-encode path as only a backend override or repetitive yes/no modal.
Generated outputs must become a first-class visible Batch Preview state.
In a mixed batch, the user should be able to understand:
- which rows are normal source/original files;
- which rows are recognized FFmpeg Encoder outputs;
- which generated outputs are excluded by default;
- which generated outputs are intentionally authorized for re-encoding;
- which rows are only **Possible previous output** legacy cases;
- what trustworthy information is known about a previous encode.
Reuse L's compact preview architecture and **Generated outputs** filter rather than creating a disconnected second interface.
Filtering must never silently authorize or alter selection.
Conceptual presentation:
```plain text
Recording 01.mkv
Original · Ready

Recording 02_H265-Nvidia-GPU.mkv
Generated output · Excluded
H.265 · NVIDIA · P5 · CQ 25
[Re-encode this output]

Old_Record_H265-CPU.mkv
Possible previous output
Historical naming evidence · exact settings unavailable
[Treat as original]
```
Exact badges/icons/layout are implementation decisions.
## Previous-encode information
Where trustworthy evidence exists, display useful prior-generation information such as:
- codec;
- encoder/backend;
- preset;
- CRF/CQ or other rate-control mode;
- bit depth;
- tune/multipass/relevant recipe settings;
- app/version/date where reliably available.
**Never guess missing provenance.**
Graceful examples:
- **Generated output · H.265 · NVIDIA · P5 · CQ 25**
- **Generated output · H.265 · NVIDIA · exact preset/quality unavailable**
- **Generated by FFmpeg Encoder · previous settings unavailable**
- **Possible previous output · inferred from historical filename**
If current K provenance lacks enough descriptive information, a small backward-compatible versioned extension for new 0.6 outputs is allowed. Descriptive provenance must never become deletion/cleanup authority or replace stronger file identity.
## Quality-loss warning
When a generated output is intentionally authorized for another lossy encode, show a concise warning equivalent to:
> **Re-encoding an already compressed video can introduce additional quality loss.**
Inform, then respect the user's explicit choice. Avoid repetitive modal spam for large batches if an equally explicit batch/selection interaction can be designed.
# 6. Binding addition B — encoder transparency
The user should be able to inspect what each visible control actually contributes to FFmpeg.
Hover/focus/help for ordinary controls should explain both:
1. what the control means;
2. the FFmpeg setting it contributes.
Examples:
- NVIDIA P5 → `-preset p5`
- NVIDIA P7 → `-preset p7`
- x265 Slow → `-preset slow`
- x264 Slower → `-preset slower`
- SVT-AV1 preset 6 → show the actual production argument used.
Do not maintain a separate renderer-side fake command table that can drift from production behavior. Where practical, derive displayed information from the same canonical configuration/builder data used by the encoder plan.
Important help must not be mouse-hover-only. Equivalent keyboard focus or info/detail access is required.
# 7. Tested Default must be inspectable
The existing L **Tested Default** helper remains in scope, but it must not be mysterious.
For every supported profile, the user should be able to inspect exactly what Tested Default applies.
Applying Tested Default must:
- populate/reflect the real ordinary controls;
- leave them editable afterward;
- expose any additional production options that are not represented by a dedicated visible control;
- never hide "magic" settings from the user.
**Tested Default remains distinct from the new Archive Quality recipe described below.**
# 8. Raw preset vs compound recipe
A native encoder preset is one setting.
A named recommendation/recipe may apply several settings together.
Do not conflate them.
For example:
- **P7** = native NVENC preset contribution.
- **Archive Quality — Ada/Blackwell NVENC** = compound quality/compression-oriented recipe that may include P7 plus tune, multipass, rate-control and reference-frame options.
The UI architecture should distinguish:
- native preset;
- quality value;
- additional encoder options;
- Tested Default;
- named compound recipe.
A future helper must always reveal the recipe it actually applies.
# 9. Binding addition C — Archive Quality — Ada/Blackwell NVENC
The earlier backlog deliberately parked the Blackwell quality recipe as future-only. **Ahmed is now explicitly promoting this specific HEVC recipe into 0.6 scope.** This section supersedes the old future-only exclusion for this feature.
Preferred user-facing name:
> **Archive Quality — Ada/Blackwell NVENC**
If evidence shows that Ada and Blackwell materially require different configurations, split it into:
- **Archive Quality — Ada NVENC**
- **Archive Quality — Blackwell NVENC**
If one validated recipe is technically appropriate for both generations, keep one shared helper instead of inventing artificial generation-specific variants.
This is specifically a **HEVC/NVENC quality/compression recipe**. It does not authorize broad generation-specific optimization for AV1/H.264 or other GPU vendors.
## Product target
Ahmed's long-standing CPU reference is:
```plain text
libx265
preset = slow
CRF = 25
```
The product question is:
> Can modern Ada/Blackwell NVENC produce HEVC output in roughly the same perceptual-quality and filesize neighborhood as x265 Slow / CRF 25, while encoding dramatically faster?
This is an empirical target, **not mathematical equivalence**.
Never encode or document a rule such as:
`x265 CRF 25 = NVENC CQ 24`
## Starting benchmark hypothesis
Re-verify everything against the **exact shipped FFmpeg 9.0.1 / NVIDIA driver/runtime** before implementation.
Starting candidate:
```plain text
encoder      = hevc_nvenc
preset       = p7
tune         = uhq
multipass    = fullres
rate control = VBR-CQ style operation
CQ           = 24 primary starting point
CQ           = 23 quality-insurance comparison
B-frames     = 4
B-ref mode   = each
```
10-bit/Main10/high-bit-depth should follow the existing product's bit-depth compatibility rules rather than being forced globally.
Treat this as a benchmark starting hypothesis, not fixed product truth.
Codex should inspect the exact shipped encoder capabilities and prove every claimed option through real short encoding. Unsupported settings must fail visibly or be excluded from the recipe; never silently pretend they are active.
Do not upgrade FFmpeg merely to obtain a desirable option without first determining whether the current shipped stack is sufficient. A runtime upgrade would be a material revalidation event, not a hidden tweak.
## Benchmark and convergence
Benchmark the complete recipe, not P7 alone.
Use representative difficult footage where safely available, especially OBS/gameplay-like material. Preserve personal originals read-only and write benchmark outputs only to isolated owned locations.
Compare Archive Quality against `libx265 -preset slow -crf 25` using, where supported:
- output filesize / bitrate;
- encode speed / realtime factor;
- VMAF and/or SSIM as supporting signals;
- visual inspection of difficult motion/detail, particles, foliage, gradients, UI/text, dark scenes and compression-stress sections;
- output decode validity;
- stream/metadata preservation expectations;
- exact resolved FFmpeg arguments.
Desired Blackwell target:
- roughly the same perceptual-quality region as x265 Slow / CRF 25;
- filesize preferably close to x265;
- approximately **\~10% extra filesize is acceptable** if it meaningfully closes the perceptual-quality gap;
- dramatically faster encoding than Ryzen 5 5600X software x265.
Start with CQ 24. If quality remains visibly behind while size headroom exists, evaluate CQ 23. If neither gives a stable enough result across representative sources, choose the most defensible value from evidence rather than forcing equivalence.
Codex may investigate additional current NVIDIA quality-oriented settings, such as adaptive quantization, if they are supported by the exact runtime and demonstrably improve this use case. Any additional option must be benchmark-justified and transparent in the UI.
# 10. Blackwell vs Ada evidence
Ahmed's current development machine uses RTX 5060 Blackwell.
Therefore:
- the **Blackwell path must receive real local encode + benchmark evidence** before 0.6 acceptance;
- final packaged 0.6 acceptance should exercise Archive Quality through the actual packaged application on Blackwell at least once.
No Ada GPU is currently available locally.
Therefore:
- a shared Ada/Blackwell recipe may be implemented if current NVIDIA documentation + exact runtime behavior support that design;
- **do not claim local Ada benchmarking**;
- do not claim Ada has independently demonstrated the same quality/size result as Blackwell;
- distinguish locally verified Blackwell behavior from documented/capability-gated but locally unverified Ada support;
- if Ada cannot be responsibly represented without hardware evidence, preserve the architecture and state the limitation rather than fabricating proof.
M must retain this evidence distinction.
# 11. Archive Quality UI behavior
Archive Quality must use the same transparent helper/recipe architecture as the rest of this amendment.
It must not replace advanced controls.
Conceptual UI:
**Archive Quality — Ada/Blackwell NVENC** ⓘ
Possible explanation:
> Quality/compression-oriented HEVC NVENC recipe for modern Ada/Blackwell hardware. Applies a validated combination of NVENC options rather than P7 alone.
The user must be able to inspect the actual active recipe:
- P7;
- UHQ;
- full-resolution multipass;
- rate-control mode;
- CQ value;
- B-frame/reference settings;
- any other validated active quality options.
Do not describe the feature merely as **"P7 — best quality."**
If recipe-specific settings are not represented by dedicated normal controls, expose them clearly through details/resolved-command UI.
Archive Quality and Tested Default must remain separate concepts:
- **Tested Default** = reliable general starting configuration for the encoder profile.
- **Archive Quality** = explicitly quality/compression-oriented compound recipe for this use case.
Do not silently replace the existing NVIDIA Tested Default with Archive Quality.
# 12. Resolved FFmpeg command / Encoding Details
Hover information is not enough to represent the complete command.
After a file has been prepared, expose a read-only per-file **Encoding Details** / **Resolved FFmpeg command** surface.
The literal invocation can depend on:
- input/output path;
- selected streams;
- metadata/chapter/attachment preservation;
- bit depth/color handling;
- provenance metadata;
- backend/codec;
- preset;
- CRF/CQ;
- recipe settings.
Therefore the display must come from the **same main-owned prepared production plan/argv used for execution**.
Required architecture:
```plain text
UI settings
→ main validates
→ production builder / prepared plan
→ actual argv
→ read-only display of that same resolved argv
```
Not:
```plain text
production argv
+
separately hardcoded renderer explanation that only looks similar
```
Before preparation, show deterministic setting contributions / current recipe. After preparation, show the stronger actual resolved per-file arguments.
Do not weaken the existing renderer/main security boundary. This is read-only transparency, not arbitrary command editing/execution.
For very long commands, use expandable details rather than forcing the complete invocation into a tiny tooltip.
# 13. Previous generation vs current generation
For re-encoded generated outputs, the interface should ideally make both sides understandable.
Where evidence exists:
```plain text
Previous generation
H.265 · NVIDIA · Archive Quality · P7 · CQ 24

Current planned generation
AV1 · NVIDIA · P6 · CQ 30
```
A full polished Previous → New comparison is desirable but not mandatory if it causes disproportionate 0.6 scope expansion.
Minimum requirement:
- clearly identify the old generated output;
- show trustworthy previous encode details when known;
- allow explicit re-encoding;
- make the current selected/resolved FFmpeg behavior inspectable.
# 14. Acceptance additions for amended L/M
The amended L/M acceptance must proportionately verify all of the following.
## Generated-output UX and intentional re-encoding
- generated outputs remain excluded by default;
- generated outputs are visually distinct in mixed batches;
- Generated Outputs filtering does not change authorization/selection;
- known previous settings are displayed correctly;
- unavailable historical settings are shown as unknown rather than guessed;
- one generated output can be explicitly authorized;
- several generated outputs can be intentionally authorized without modal spam;
- authorization does not affect unrelated generated outputs;
- replacing/changing a file invalidates authorization;
- reprepare/restart does not accidentally preserve temporary authorization;
- an authorized generated output can actually be encoded again with changed codec/backend/preset/quality;
- the new result receives normal provenance;
- future same-folder preparation again excludes the new generated output by default;
- no-overwrite, source protection, cancellation, cleanup and publication guarantees remain intact.
## Encoder transparency
- ordinary preset help matches the actual production setting contribution;
- Tested Default details match what it really applies;
- applying Tested Default leaves visible ordinary controls editable;
- no hidden undocumented settings are applied by helpers;
- prepared file details expose actual resolved production argv or an accurately labelled equivalent;
- changing controls changes both execution and displayed resolved details consistently;
- CPU and NVIDIA examples are covered;
- CRF vs CQ semantics remain distinct;
- hover and keyboard/focus access both work;
- long command details remain usable at supported window sizes;
- renderer security authority is not broadened.
## Archive Quality — Ada/Blackwell NVENC
- every claimed recipe option exists in the exact shipped runtime;
- unsupported settings are not silently ignored;
- real RTX 5060 Blackwell HEVC Archive Quality encode succeeds;
- output fully decodes;
- displayed resolved arguments match executed settings;
- Archive Quality remains inspectable and does not hide/corrupt advanced controls;
- switching away from the recipe returns to normal editable behavior predictably;
- Tested Default remains distinct;
- CQ 24 vs CQ 23 evidence is recorded instead of assumed;
- comparison to x265 Slow / CRF 25 includes filesize, quality and speed evidence;
- final recipe choice is evidence-backed;
- bit-depth/stream/metadata behavior remains compatible with existing rules;
- same-folder/provenance/re-encode behavior remains intact;
- final portable 0.6 artifact exercises the Blackwell Archive Quality path;
- Ada support limitations are stated honestly.
An independent acceptance reviewer must check that UI/documentation wording does not overclaim **best possible**, **identical to x265**, or **mathematical equivalence**.
# 15. Scope boundaries that remain unchanged
This amendment **does not** authorize:
- broad Fast/Balanced/Quality recipe families;
- AV1 generation-specific optimization recipes;
- H.264 generation-specific optimization recipes;
- AMD/Intel encoder implementation;
- resolution/scaling;
- multi-resolution outputs;
- Convert / Extract / Remux workspace;
- Windows installer;
- icon;
- About/Credits UI;
- public/GitHub release;
- unrelated filesystem/storage repair;
- unrelated GPU-generation tuning work.
Keep this addition focused on:
1. intentional generated-output re-encoding;
2. provenance-aware Batch Preview UX;
3. encoder/tooltips/command transparency;
4. HEVC Archive Quality recipe for Ada/Blackwell, with Blackwell locally verified;
5. completion of amended L and then M portable 0.6 acceptance.
# 16. Final execution directive
Codex should treat this page as a **binding product-owner amendment to the active 0.6 Goal**.
After reading it:
1. Recovery-Reconcile the current live L state.
2. Preserve all valid unfinished specialist work.
3. Update the local Goal/Plan/Continuation/acceptance documentation to reflect the amendment.
4. Implement the smallest coherent architecture that satisfies these requirements without weakening J/K.
5. Use specialist/subagent decomposition where it improves safety or evidence quality.
6. Test proportionately; do not replay expensive unrelated J/K campaigns.
7. Use independent acceptance review before declaring amended L complete.
8. Synchronize affected project documentation at the milestone boundary.
9. Proceed to M only after the amended L contract is genuinely satisfied.
10. Package/tag `local-v0.6.0` only after final artifact-level acceptance succeeds.
<callout icon="✅" color="green_bg">
	**Human intent in one sentence:** FFmpeg Encoder 0.6 should be fast and safe for large same-folder archives, but also flexible enough to deliberately re-encode its own outputs, transparent enough to show what FFmpeg is really doing, and capable of a locally benchmarked Blackwell quality-oriented HEVC recipe before the final 0.6 package is sealed.
</callout>
## Related project pages
- <mention-page url="https://app.notion.com/p/3d6bd7ade63b817e9a55d61cf203bb9e"/>
- <mention-page url="https://app.notion.com/p/3d5bd7ade63b81f6a06ee953fc41d152"/>
- <mention-page url="https://app.notion.com/p/3d4bd7ade63b817aa701e613dd5c5b94"/>
</content>
</page>
