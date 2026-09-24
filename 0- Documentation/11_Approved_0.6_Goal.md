> September24 acceptance progress: J/K/L remain accepted; field16 corrections/Decision17 and the fresh M runtime pass. J–M including amendments13/14/16 are accepted after independent review and parent synchronization; local-v0.6.0 anchors the closure documented in the [M report](Execution%20Summaries/2026-09-24_Portable_0.6_Acceptance.md). The approved requirements below retain their historical wording.

> September 23 field-QA amendment: [binding note16](16_Approved_0.6_Field_QA_Amendment.md) adds Samsung preservation, source-identity diagnostics and real-field Archive CQ acceptance gates. Historical L/Decision15 remain intact; final M requires corrections, fresh ZIP and independent evidence.

> Superseding scope clarification: [September 19 binding Archive Quality amendment](14_Approved_0.6_Archive_Quality_Amendment.md) promotes only the HEVC Archive Quality Ada/Blackwell recipe into amended L/M. All new option, benchmark, native and portable acceptance gates apply; original Tested Defaults remain unchanged.

> September 13, 2026 binding amendment: [Intentional re-encoding and encoder transparency](13_Approved_0.6_Product_Amendment.md) supplements this record and supersedes the old prohibition on explicit re-encoding of confidently recognized generated outputs. Default exclusion and accepted K safety remain. All added L/M acceptance gates must pass before final 0.6 closure.


Goal — FFmpeg Encoder local 0.6 Archive Workflow & Inspection Reuse
Implement the approved FFmpeg Encoder 0.6 — Archive Workflow and Inspection Reuse plan from this thread, beginning from the accepted local-v0.5.0 baseline at commit:
f3efdeb47531106a740efb55299c5251b9a7a505
The approved planning work, specialist research, and subagent findings from the preceding Plan Mode cycles are part of the execution context for this Goal.
Do not restart the planning investigation from scratch. Reuse the completed parent planning work, Inspection Planning research, Profile Acceptance findings, AMD/Intel appendix, measurements, architecture analysis, and accepted 0.6 plan unless new implementation evidence contradicts them.
The Goal is complete only when the approved J–M product outcomes are implemented, verified, independently reviewed, documented, packaged, and accepted as a separate recoverable:
local-v0.6.0
milestone.

Human / AI authority and provenance
Human product authority
Ahmed
Ahmed owns:
	• product direction;
	• approval boundaries;
	• final human/product acceptance;
	• any expansion beyond the approved 0.6 scope.
Mother Thread / strategic review
ChatGPT — GPT-5.6 Sol / Jerry
Role:
	• strategic interpretation;
	• architecture/product review;
	• PBS methodology;
	• continuity;
	• later evaluation of Codex output.
Engineering executor
Codex — GPT-6 Astra — Ultra effort
Role:
	• technical decomposition;
	• implementation;
	• specialist/subagent orchestration;
	• debugging;
	• testing;
	• local engineering decisions within this approved Goal;
	• Git/checkpoints;
	• execution evidence;
	• documentation synchronization;
	• packaged-artifact acceptance.
Record relevant AI/model/execution provenance in formal Decision/Execution records where it materially affects historical interpretation.

Product philosophy
The application is designed:
	for Ahmed first, others later.
It is an advanced-but-accessible FFmpeg encoder UI for a technically curious user with large OBS/gameplay/video archives.
The direct expert controls are a core product feature.
Do not redesign the application around a simplified beginner wizard.
Codec, hardware backend, preset, CRF/CQ and other expert controls must remain directly visible and freely adjustable.
Beginner-friendly assistance must remain secondary and unobtrusive through things such as:
	• hover explanations;
	• tooltips;
	• subtle info icons;
	• compact Tested Default helpers;
	• contextual explanation.
The design principle is:
	Advanced controls first. Beginner assistance second.
Any helper must visibly populate the normal controls rather than hiding the actual values being used.

Required outcomes
J — Inspection reuse
Implement the approved inspection-performance architecture.
Required outcomes:
	• repeated preparation of unchanged completed OBS/archive files uses safely validated persistent inspection evidence;
	• cache reuse survives application restarts;
	• cold and cached inspection decisions remain equivalent within the approved policy;
	• cache invalidation fails conservatively;
	• stale, corrupt, truncated, oversized, unknown-version or incompatible cache data becomes a cache miss rather than trusted evidence;
	• incomplete/cancelled/timed-out inspections are not promoted to valid reusable results;
	• source identity is revalidated appropriately;
	• cache reuse is profile-independent where approved;
	• hardware availability, destination state and prepared-plan authority remain fresh rather than cached incorrectly;
	• inspection concurrency preserves exact child/process ownership and cancellation lifecycle;
	• restart cannot overlap lingering inspection work;
	• valid cache hits launch zero unnecessary media-inspection ffprobe processes;
	• uncached/unsupported storage remains usable through normal fresh inspection;
	• failure of the optional filesystem eligibility helper affects performance only, not encoding availability.
Preserve the approved conservative HDR/SDR behavior.
Do not weaken inspection simply for speed.
Do not add a generic Skip Inspection or Fast/Trusted Mode unless implementation evidence demonstrates a compelling reason and Ahmed separately approves the changed safety contract.
Performance acceptance
Use representative completed OBS/archive media.
Test the approved warm-preparation target for approximately 60–70 unchanged files:
	target: preparation within approximately eight seconds after capability initialization.
This is a target, not permission to falsify evidence.
If the target is not met despite a sound implementation:
	• diagnose the bottleneck;
	• improve it where safely possible;
	• otherwise surface the remaining performance gap explicitly during acceptance rather than weakening correctness.

Inspection transparency / UX
The user should understand what the program is doing during preparation.
Implement a clean, subtle explanation of inspection.
The UI should communicate, where appropriate, that inspection determines information such as:
	• video duration;
	• stream inventory;
	• preservation requirements;
	• primary video;
	• resolution/cadence;
	• bit depth;
	• compatibility;
	• color evidence;
	• SDR/HDR safety.
Use the approved visual language.
Suitable ideas include:
	• a small information icon;
	• hover text/tooltips;
	• stage/status text;
	• reused/new inspection counts;
	• elapsed time;
	• preparation progress.
Example style:
	Checking 60 recordings · 54 reused · 2 inspecting
Do not invent fake percentages for within-file work that cannot be measured meaningfully.
Keep startup capability checking visually distinct from batch/media inspection where practical.

Inspection cache storage eligibility
Implement the approved conservative first version.
Fast persistent reuse should initially target validated ordinary local fixed NTFS storage with reliable file identity.
The approved bounded Windows helper may use Windows PowerShell/.NET DriveInfo only as an eligibility check.
Requirements:
	• use the absolute trusted Windows PowerShell executable;
	• shell: false;
	• no PATH search;
	• no elevation;
	• no ExecutionPolicy Bypass;
	• no profiles/modules/remoting;
	• fixed code only;
	• bounded drive-root data passed as data, not executable stdin;
	• bounded stdout;
	• bounded timeout;
	• cancellation owns/kills only the helper child;
	• malformed output or helper failure means uncached inspection;
	• never assume NTFS if verification fails.
UNC/network/removable/unknown/unsupported storage remains usable through fresh uncached inspection.
Do not turn the helper into a broad system-discovery mechanism.

K — Safe output beside originals
Enable the same-folder workflow only through the approved provenance and publication model.
Ahmed wants to be able to use:
	input folder = output folder
so originals and completed encodes remain together.
Primary use case:
	• large OBS/gameplay recording directory;
	• encoded output appears beside its original;
	• stopping a long batch halfway makes completion visually obvious;
	• no need to cross-reference two directories.
Do not implement this by merely removing the existing equal-folder guard.
Required safety properties:
	• no accidental overwrite;
	• no deletion of originals;
	• no deletion of completed outputs;
	• no recursive suffix chains;
	• generated outputs do not silently become future source inputs;
	• no unsafe cleanup;
	• source snapshot remains deterministic;
	• destination races remain safe;
	• cancellation/restart remains safe;
	• distinct-folder workflow remains compatible.

Output provenance
Implement the approved provenance design.
New application-generated Matroska outputs should receive:
	• a reserved versioned application marker;
	• a unique output ID.
Main owns generation of these values.
The staged output must contain the expected marker/ID and validation must verify it before publication.
Maintain a separate local provenance index/journal.
Important:
	provenance identifies files; it does not grant deletion authority.
Provenance records must remain separate from cleanup ownership.
Cleanup authority remains restricted to explicitly owned staging/incomplete objects.
Malformed, conflicting, partial, unknown-version or otherwise suspicious reserved marker data must fail conservatively and never silently become “ordinary unmarked source.”

Legacy-output handling
Do not rewrite old 0.5.0 media merely to add provenance.
Existing historical outputs lack the new marker.
Handle them conservatively.
Historical output naming/suffix patterns may be recognized as:
	Possible previous output
and excluded from default source selection.
For an ambiguous unmarked file, support the approved explicit:
	Treat as original
override only when appropriate.
The override must be:
	• main-owned;
	• bound to the currently prepared file identity;
	• invalidated when the plan/file changes;
	• rechecked before encoding.
Do not offer an override for a confidently recognized marked generated output.
Keep legacy suffix recognition independent of whether the current machine has that old hardware/profile available.

Prepared-directory safety
Protect the full baseline source snapshot.
Reserve every baseline input pathname and reliable filesystem identity as a forbidden destination during that prepared plan, even if a source disappears afterward.
Do not allow newly appearing files to silently join an already prepared batch.
Reject symbolic-link inputs under the approved policy.
Handle hard-linked aliases conservatively.
Retain duplicate-destination and same-stem conflict handling.
Revalidate source identity and provenance before actual encoding where required.

Publication safety
For same-folder mode:
	• persist publication intent before encoding/publication;
	• failure to persist required intent must prevent unsafe publication;
	• validate the completed staged output, including provenance marker;
	• publish atomically and exclusively using the approved hard-link mechanism;
	• if atomic exclusive publication is unavailable, fail closed for same-folder mode;
	• do not silently fall back to a non-atomic copy in same-folder mode.
Distinct-folder operation may retain its existing documented publication fallback where approved.
Recovery must distinguish:
	• matching published output;
	• absent destination;
	• unrelated race winner;
	• uncertain/partial state.
Never automatically overwrite, republish or delete based solely on journal/index intent.
If final index recording fails after a valid output was already published:
	• preserve the completed output;
	• preserve/report pending bookkeeping state;
	• do not delete the valid output to make bookkeeping look clean.

Honest provenance limits
Do not overclaim perfect historical tracking.
Document the unavoidable boundary:
external remuxing/editing that removes the application marker and also breaks any stored filesystem identity, combined with renaming or index loss, can make a generated output indistinguishable from an original.
The 0.6 guarantee should cover:
	• recognized marked outputs;
	• ordinary rename/copy scenarios;
	• matching index evidence;
	• conservative legacy recognition;
	• detected races;
	• known supported provenance cases.
Do not claim detection after all identifying evidence has been intentionally or externally removed.

L — Remembered workflow and compact UI
Implement safe local workflow persistence.
At minimum remember:
	• last valid input folder;
	• last valid output folder;
	• last selected profile;
	• last valid preset per profile;
	• last valid CRF/CQ per profile.
Folders must be revalidated by main on application startup.
Stored filesystem paths are preferences only.
They must not become reusable IPC/path authority tokens.
Create fresh main-owned role/folder identities when restoring valid locations.
Missing/disconnected/unavailable paths should remain visibly unavailable and offer a clean choose-folder action.
Do not automatically create directories or begin encoding merely because preferences exist.

Per-profile settings
Each profile should remember its own manual values.
Example:
	• H.265 CPU may remember slow / CRF 25;
	• H.265 NVIDIA may independently remember p6 / CQ 23.
Switching profiles should restore the remembered values for that profile.
Invalid/stale stored values should fall back to that profile's tested defaults with a brief clear explanation.
Unavailable hardware profiles must remain explicitly unavailable.
Do not silently substitute software or another backend.

Reset actions
Keep responsibilities separate.
Provide clearly scoped actions such as:
	• Reset current profile settings
	• Forget remembered locations/settings
	• Clear inspection cache
These actions must not delete:
	• output provenance;
	• user media;
	• completed outputs;
	• unrelated application data.
Do not merge cache, preferences and provenance into one resettable state bucket.

Large Batch Preview
Make 60–70-file batches manageable without hiding important evidence.
Implement the approved compact/bounded design.
Expected behavior includes:
	• compact rows;
	• bounded preview viewport;
	• expandable per-file details;
	• collapsible summary;
	• filter/count support such as:
		○ All
		○ Needs attention
		○ Skipped
		○ Generated outputs
	• automatically prioritize Needs Attention when meaningful problems exist;
	• large clean batches may start collapsed;
	• selected count remains visible;
	• hidden-selected count remains visible where relevant;
	• filtering must not silently change selection;
	• warnings and Start controls remain accessible outside the scrollable list;
	• preserve expanded state/focus/selection reasonably during updates;
	• conflicts, unsupported media, provenance ambiguity, generated outputs and encoding failures remain semantically distinct.
Do not add virtualization merely because it is fashionable.
The approved 60–70-file scale does not currently justify it unless real profiling proves otherwise.

Tested Default helper
Keep direct expert controls visible.
Add the approved subtle Tested Default helper.
Initial accepted operational defaults remain:
Profile	Preset	Quality
H.264 CPU	slower	CRF 24
H.265 CPU	slow	CRF 25
AV1 CPU	6	CRF 32
H.264 NVIDIA	p5	CQ 28
H.265 NVIDIA	p5	CQ 25
AV1 NVIDIA	p5	CQ 30
Clicking Tested Default should visibly populate the existing normal controls.
Ahmed must remain free to immediately modify them.
Applying the helper should update the profile's remembered values appropriately.
The UI should show the actual values being applied.
Do not hide them behind vague language.

Encoder-control explanations
Add subtle help/tooltips where useful.
Explain things such as:
	• NVIDIA P1–P7 generally moving from faster to slower/more encoder effort;
	• CPU preset semantics being encoder-specific;
	• SVT numeric preset direction differing from NVIDIA;
	• CRF and NVENC VBR-CQ being different control systems;
	• equal numbers across encoders not implying equal perceptual quality;
	• Tested Default meaning “verified operational starting point,” not “universally optimal quality.”
Do not turn the interface into a beginner tutorial.
Full educational documentation remains a later backlog item.

AMD AMF and Intel QSV
AMD/Intel remain research-only in 0.6.
Do not add selectable AMD or Intel encoding backends in this Goal.
Preserve the completed Profile Acceptance research as future design evidence.
Established planning findings include:
	• bundled FFmpeg 9.0.1 contains AMF and libvpl support;
	• relevant AMF/QSV wrapper names/help exist;
	• this Ryzen 5600X + RTX 5060 machine cannot verify actual AMD/Intel hardware encoding;
	• AMD support varies materially across VCN generations/products;
	• Intel Quick Sync support varies across graphics generations and Arc/Core Ultra hardware;
	• H.264 hardware 10-bit support must not be inferred from parser input formats;
	• AMF and QSV require backend-specific rate-control/preset logic;
	• the current generic non-NVIDIA → CRF assumption is insufficient;
	• future support should rely on real adapter-specific capability probes, production arguments, short verified encodes, ffprobe validation and full decode;
	• unavailable/partial support must have explicit reasons;
	• no silent hardware/software fallback.
Do not repeat expensive AMD/Intel research unless new implementation evidence genuinely requires clarification.

Explicitly out of scope for 0.6
Do not expand this Goal into:
	• AMD implementation;
	• Intel implementation;
	• output resolution/scaling;
	• multi-resolution ladders;
	• Convert / Extract / Remux workspace;
	• audio extraction/conversion;
	• Windows installer;
	• About page;
	• Credits UI;
	• Licenses UI beyond existing required distribution material;
	• custom application icon;
	• full end-user learning guide;
	• PDF guide;
	• GitHub upload;
	• public release;
	• updater;
	• code signing;
	• 1.0.0;
	• unrelated product redesign.
These remain future backlog items.

M — Integrated local 0.6 acceptance
Do not consider 0.6 complete when implementation compiles or unit tests pass.
Build a separate local Windows portable 0.6.0 artifact without altering/replacing the accepted 0.5.0 artifact.
Acceptance should cover representative actual packaged-app behavior including, where relevant:
	• same-folder source/output;
	• generated-output recognition;
	• second-batch behavior;
	• no suffix chains;
	• legacy ambiguous-output handling;
	• provenance corruption/marker issues;
	• destination races;
	• safe publication;
	• cache cold/warm equivalence;
	• one changed/new file causing expensive inspection only where required;
	• cache invalidation;
	• corrupt cache;
	• unsupported cache storage/helper failure;
	• remembered folders/settings;
	• per-profile persistence;
	• reset behaviors;
	• large preview UX;
	• Tested Default helpers;
	• real CPU/NVIDIA encode paths affected by new changes;
	• skip behavior;
	• cancellation;
	• restart;
	• subsequent batch;
	• output protection;
	• portable extraction;
	• alternate working directory;
	• restricted PATH;
	• process-scoped offline/local behavior using the already accepted evidence discipline;
	• bundled resource integrity;
	• clean owned-child shutdown.
Reuse accepted 0.5.0 runtime/profile/preservation evidence when those behaviors remain genuinely unchanged.
Do not blindly rerun the historical 110-case matrix merely for ceremony.
Broaden regression/testing only where changed behavior or failures justify it.

Independent acceptance review
Major milestone completion must not rely solely on the implementing parent agent's claim.
Use an independent Acceptance Gap / requirement-to-evidence reviewer where practical.
The reviewer should compare:
	approved requirement
	versus
	actual evidence
and identify anything still unproven.
Implementation, verification and acceptance remain separate concepts.

Git / version / recoverability
Preserve the accepted:
local-v0.5.0
tag, source state, ZIP and evidence unchanged.
After normal live-state reconciliation, follow the approved development line:
Branch:
codex/archive-workflow
Development version:
0.6.0-dev.1
Accepted endpoint:
local-v0.6.0
Keep runtime versions pinned unless a genuinely necessary approved reason emerges.
Separate meaningful checkpoints sufficiently to preserve regression attribution, especially around:
	• inspection cache;
	• concurrency;
	• provenance/publication;
	• persistence;
	• UI integration;
	• portable acceptance.
Do not rewrite destructive Git history.
Maintain cheap rollback throughout.

Storage gate disposition — D:
Ahmed has reviewed the pre-existing D: warning.
Current observed context:
	• C: and D: are partitions on the same Samsung SSD 980 NVMe;
	• CrystalDiskInfo currently reports:
		○ Good 90%
		○ Critical Warning 0
		○ approximately 37°C;
	• Windows has a longstanding D: filesystem-repair warning dating back before this development arc;
	• Ahmed reports previous CHKDSK attempts failing around stage 2;
	• this is acknowledged but intentionally separated from the FFmpeg development scope.
Ahmed explicitly authorizes continued project-local development on D:.
Do not spend this Goal's compute diagnosing or repairing the longstanding D: condition.
Do not automatically:
	• run CHKDSK repairs;
	• run filesystem repair tools;
	• relocate the repository;
	• alter partitions;
	• perform machine-global storage changes.
Continue normal:
	• Git discipline;
	• checkpoints;
	• project backups;
	• isolated test media/artifacts.
If actual new project I/O trouble appears, including:
	• failed Git writes;
	• file corruption;
	• inexplicable filesystem behavior;
	• repeated read/write errors;
	• evidence of worsening storage failure;
stop the affected work and report the concrete evidence to Ahmed rather than attempting storage repair autonomously.
The separate D: filesystem diagnostic remains parked outside this Goal.

Test media / Ahmed's archive
Use isolated fixtures, generated media, or copies for destructive/write-heavy tests.
Treat Ahmed's real OBS archive as read-only unless an explicitly approved test requires otherwise.
Do not modify/delete original personal archive media for development testing.
Representative real archive media may be inspected/read when authorized by existing project scope, but do not use irreplaceable originals as disposable fixtures.

Project-local scratchpad / working ground
If useful for long-horizon continuity, Codex may create and maintain a compact project-local working scratchpad.
Purpose:
	• temporary discoveries;
	• hypotheses;
	• unresolved questions;
	• pending test ideas;
	• useful subagent findings;
	• active cross-cycle reasoning artifacts;
	• reminders that help recover after context compaction/quota interruption.
This scratchpad is non-authoritative.
It must not replace or outrank:
	• live Git/project state;
	• Current State;
	• Approved 0.6 Plan;
	• Continuation State;
	• Execution Summaries;
	• verified test/acceptance evidence.
Suggested behavior:
	• keep it concise;
	• reconcile it against newer evidence;
	• mark/correct superseded assumptions;
	• periodically compress stale notes;
	• avoid duplicating entire authoritative documents;
	• do not let scratchpad maintenance consume significant quota.
A project-local Markdown scratchpad is preferred because Codex has direct access to the repository.
A separate Notion scratchpad is optional, not required.
Do not make the workflow dependent on Notion availability.

Documentation
At every accepted milestone, perform parent synchronization against live Git/evidence.
Update affected living documentation proportionally, including where relevant:
	• Current State;
	• Roadmap;
	• Approved acceptance gates;
	• Execution Index;
	• Session Summary;
	• Technical Reference;
	• Architecture;
	• Security & Testing;
	• README;
	• CHANGELOG;
	• Continuation State while unfinished.
Use dated milestone Execution Summaries.
Do not rewrite sound historical documentation unnecessarily.
Canonical PBS remains external.
Project-local documentation should record only the project-specific operational context needed.

Recovery Reconciliation
On every autonomous continuation after quota interruption or context compaction:
	1. inspect live Git status/log;
	2. inspect current working-tree changes;
	3. inspect newest relevant artifacts/tests;
	4. compare reality against Continuation State;
	5. recover completed-but-undocumented work;
	6. preserve useful subagent outputs;
	7. update only enough resume state to avoid duplicate work;
	8. continue the exact unfinished milestone.
Live repository/evidence state outranks stale continuation prose.
Do not restart accepted J/K/L work merely because a resume note is behind.
Continuation State is a resume aid, not unquestionable truth.

Autonomous execution
Ordinary local:
	• coding mistakes;
	• failed tests;
	• harness mistakes;
	• dependency/tool incompatibilities;
	• implementation dead ends;
	• recoverable regressions;
are authorized engineering work.
Diagnose and correct them autonomously.
Do not stop merely because a test fails.
Do not weaken product requirements to make failures disappear.
If a chosen implementation/tool proves unsuitable, adapt the technique while preserving the approved product/acceptance contract.
Stop only for:
	• a genuine Ahmed approval boundary;
	• destructive or unrelated filesystem action;
	• machine-global/system changes not already authorized;
	• credentials/secrets;
	• destructive Git history;
	• GitHub/public release;
	• major product-direction expansion;
	• serious unsafe/unresolvable storage/environment condition;
	• other explicit existing approval gates.

Autonomous continuation schedule
The existing recurring approximately five-hour continuation automation must remain attached to this Goal.
When quota interrupts execution:
	• do not require Ahmed to manually restart the work;
	• wake after the next available window;
	• run Recovery Reconciliation;
	• resume the exact unfinished milestone;
	• reuse completed investigation and subagent work;
	• avoid replaying accepted evidence unnecessarily.
Never redeem or trigger usage reset credits automatically.
If the observed reset boundary changes, realign the existing recurring task rather than accumulating duplicate schedules.

Scheduler stopping rule
Disable the recurring continuation automation only when either:
	1. the full approved Goal is independently verified complete at local-v0.6.0, documentation is synchronized, Git is clean/recoverable, and no approved J–M work remains;
or
	2. a genuine Ahmed approval boundary or unsafe/unresolvable condition prevents further work.
Do not continue inventing new backlog work after the Goal is satisfied merely to keep the automation busy.
Correct autonomous stopping is part of the acceptance contract.

Evidence discipline
Preserve the evidence standards demonstrated during 0.5.0.
Do not claim a property merely because:
	• an API intended to create it was called;
	• an encoder name appears in help;
	• a test exited zero;
	• a build succeeded;
	• documentation says it should work.
Where material, verify the observable outcome.
Failed verification methods are useful evidence.
If an attempted test does not actually establish the intended condition:
	• record the limitation;
	• find a stronger test where practical;
	• do not rewrite the result as a pass.
Clearly distinguish:
	• real native evidence;
	• synthetic/injected evidence;
	• structured media fixtures;
	• vendor-documented expectations;
	• locally verified facts;
	• unsupported assumptions.

Compute / quota discipline
GPT-6 Astra Ultra is intentionally being used for high-value frontier engineering work, but quota is finite.
Use compute intelligently.
Avoid:
	• repeating accepted research;
	• rerunning unrelated expensive historical matrices;
	• repeatedly rereading the entire project/PBS corpus;
	• regenerating sound documentation for stylistic reasons;
	• maintaining redundant scratchpad/state documents.
Prefer the smallest sufficient runtime context:
	Goal
		○ Approved 0.6 Plan
		○ AGENTS/project instructions
		○ live Git
		○ Current State
		○ Continuation State
		○ relevant Execution Summary/evidence
		○ useful working scratchpad where necessary.
Use specialist/subagents where they materially improve research, implementation, testing, or independent acceptance.

Definition of done
Do not consider this Goal complete merely because:
	• all code changes exist;
	• the UI looks correct;
	• unit tests are green;
	• the development app works;
	• a ZIP was created.
Completion requires all of the following:
	• J acceptance criteria satisfied;
	• K acceptance criteria satisfied;
	• L acceptance criteria satisfied;
	• M integrated acceptance satisfied;
	• relevant real application/native workflows passed;
	• inspection reuse and performance evaluated honestly;
	• same-folder safety verified against actual implementation/evidence;
	• persistence and compact-preview behavior verified;
	• Tested Default behavior maps exactly to visible controls and actual prepared/encoder arguments;
	• representative packaged-app encode/skip/cancel/restart behavior passed;
	• portable 0.6.0 artifact itself accepted;
	• original local-v0.5.0 artifact/evidence remains intact;
	• known evidence limits are documented honestly;
	• independent Acceptance Gap review reports no unresolved approved blocker;
	• affected documentation is synchronized against live Git/evidence;
	• final branch is clean and recoverable;
	• accepted local tag/checkpoint local-v0.6.0 exists only after acceptance;
	• recurring continuation is disabled at verified Goal closure.

Final operating principle
The purpose of this Goal is not simply:
	“implement the plan.”
The intended outcome is:
	Turn the accepted FFmpeg Encoder 0.5.0 foundation into a locally accepted 0.6.0 archive-oriented workflow where repeated large OBS batches prepare dramatically faster, originals and encoded outputs can safely coexist in the same folder, the application remembers Ahmed's workflow, large batches are easier to manage, expert controls remain first-class, and all of these changes preserve the security, process, media-preservation, output-protection, recoverability, documentation, and evidence standards established by 0.5.0.
Autonomously implement, test, diagnose, recover, verify, document and package toward that outcome until its approved definition of done is satisfied or a genuine approval boundary requires Ahmed.
