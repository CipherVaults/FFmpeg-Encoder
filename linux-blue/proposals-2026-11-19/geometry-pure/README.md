# Pure marked geometry helper, unbound and inactive

This helper creates only in-memory synthetic YUV420 buffers during inert tests. It launches no tools, writes no media, imports no application modules and grants no authority. The output-sized pattern is an analytical ideal control, NOT a simulated FFmpeg result or independent resampling oracle. Real output must later be obtained from the actual runtime.

Fixed source960×1440/output720×1080; neutral chroma128, baseY96; patches and strips match the accepted plan. Frame motion is x=400+4*(frameIndex mod32), y680,16×16,Y192, outside measured regions. The test indices19/50/81 are synthetic examples only, not a binding of actual trim source-frame membership; actual plan determines correspondence. All three selected frames must later compare, no best-frame choice.

The producer awaits each sink before allocating its next frame; the real sink must honor backpressure and retain at most one preceding frame. This is not an enforced bound against a malicious callback retaining buffers. Capture preallocates exact three-frame bytes, rejects overflow/truncation/reuse, and avoids unbounded chunk arrays. Returned slices retain one bounded backing buffer. No RSS guarantee is made. Source capture6,220,800 bytes/output3,499,200 bytes, each below16MiB.

Tests cover ideal and perturbed interiors; missing/swapped corners; both mirrors; crop-rescale; translation; nonuniform stretch; each missing strip/square edge; exact lengths/indices; producer await/failure/abort; capture limits. Fixed center scanlines/thresholds and masks do not fit observed geometry. Pure content checks are geometry probes, not visual quality or complete image equivalence. Noise tolerance is prospective; no threshold was fitted to actual media.

Remaining interface decisions are in INTERFACE_TRACE.md. No generator PCM recipe, runtime binding, collector allowlist or actual service driver is supplied in this pure stage. Those require separate exact review; no acquisition gate can be inferred from this handoff.
