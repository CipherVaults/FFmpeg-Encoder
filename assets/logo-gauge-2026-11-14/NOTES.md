# Gauge artwork / November 14, 2026

Gauge is the owner's selected project mark. This folder prepares the requested
theme marks and two Windows choices for review. Nothing is wired into the app,
packaging or shipped icon. No ICO is built. Selection of a Windows option and
actual shell/taskbar verification remain with Ahmed and Claude.

## Files

- `gauge-app-dark.svg`, `gauge-app-light.svg`: 256-grid selected Gauge paths,
  unchanged from the original candidate except that light mode now keeps amber.
  Frame: dark theme `#edf0f4`; light theme `#1c2925`. Output square ring:
  `#ffad42` in both, with identical geometry and filled area. “Square” refers to
  the candidate's filled square-ring path with a transparent central aperture,
  not a newly filled-in solid block. There is no background tile.
- `gauge-app-{dark,light,currentcolor}-{16,20,24}.svg`: native-pixel optical
  drawings. The 16 px drawing preserves the original selected small geometry;
  20 and 24 are separately snapped, rather than scaled fractional rails. The
  two tiny measurement ticks are omitted at small sizes.
- `gauge-app-currentcolor.svg`: the 256-grid frame and ticks use currentColor;
  the square stays fixed amber. **Inline SVG inherits the host's CSS color.** An
  SVG loaded through an HTML img element does not inherit its host's color.
  Use inline SVG for a single theme-following asset; external-image consumers
  should choose the explicit dark/light file. The page demonstrates inheritance.
- `gauge-lockup-{dark,light,currentcolor}.svg`: matching transparent 560 × 96
  lockups. “FFmpeg Encoder” is live 40 px, weight 600 text using Segoe UI Variable,
  Segoe UI, system-ui, sans-serif. No embedded or downloaded fonts; font metrics
  can vary on another OS. Geometry is paths; the requested wordmark is live text.
- `gauge-app-light-edge-alternative-{16,20,24}.svg`: **optional alternative**,
  not a replacement. Adds a centred 0.5 px dark stroke to the square's outside
  and aperture perimeter, leaving its amber fill and path unchanged. Antialiasing
  naturally blends the boundary pixels; interior amber remains exact. No edge
  is added to the requested main assets or the Windows amber square.
- `gauge-win-{outlined,midtone}-{16,20,24,32,40,48,64,128,256}.svg` and matching
  PNGs: 18 native-pixel SVG masters and 18 transparent RGBA PNGs. Every Windows
  path coordinate and contour boundary is an integer. Outlined: dark frame
  `#1c2925`, outside light edge `#edf0f4`, fixed amber square. Mid-tone: neutral
  `#808080` frame, same fixed amber square. Neither contains a tile.
- `preview.html`: self-contained offline review. All SVGs are inline; actual
  exported Windows PNG bytes are embedded as HTML data images, never inside SVG.
  Both app themes appear on their actual surface/background/inset tokens at all
  nine sizes. Both Windows choices appear beside the current shipped icon at
  every size on four backgrounds. The original comparison SVGs are read without
  changing their artwork, including the shipped optical 16/20/24/32 sources.
- `review-in-app.png`, `review-windows-outlined.png`,
  `review-windows-midtone.png`, `review-side-by-side.png`: full-section Chromium
  captures of that page at device scale 1 and a 1680 px viewport. Native small
  marks should be judged at 100% image zoom; comparison also has 6× pixel zooms.
- `make-gauge.cjs`: reproducible original geometry, contrast calculations,
  documentation and offline page generator. `check-review.cjs`: source safety,
  XML parsing, raster export/decode, pixel checks, DOM sizing and review captures.
  `verification.json`: exact versions, results, pixel statistics and SHA-256s.

## Measured contrast

Relative sRGB luminance is calculated after channel linearisation:
v/12.92 for v <= 0.04045, otherwise ((v+0.055)/1.055)^2.4. Weights are
0.2126 R + 0.7152 G + 0.0722 B. Contrast = (Llighter+0.05)/(Ldarker+0.05).
These ratios compare solid colours, not antialiased edge pixels or human visual
acceptance. They are not text-legibility or accessibility certification.

| Review surface | Background | Amber | Dark frame | Light frame/edge | Mid-tone frame |
| --- | --- | ---: | ---: | ---: | ---: |
| Dark / surface | `#181d24` | 9.119 | 1.124 | 14.815 | 4.288 |
| Light / surface | `#ffffff` | 1.857 | 15.073 | 1.143 | 3.949 |
| Dark / background | `#101318` | 10.022 | 1.235 | 16.281 | 4.712 |
| Light / background | `#f7f7f4` | 1.730 | 14.043 | 1.065 | 3.680 |
| Dark / inset | `#202630` | 8.186 | 1.009 | 13.300 | 3.849 |
| Light / inset | `#f0f3f1` | 1.662 | 13.490 | 1.023 | 3.535 |
| Dark taskbar | `#202020` | 8.774 | 1.081 | 14.254 | 4.125 |
| Light taskbar | `#f3f3f3` | 1.674 | 13.583 | 1.030 | 3.559 |
| White Explorer | `#ffffff` | 1.857 | 15.073 | 1.143 | 3.949 |
| Dark Explorer | `#191919` | 9.467 | 1.166 | 15.381 | 4.452 |

Additional colour pairs: amber/dark frame **8.116:1**;
amber/mid-tone **2.127:1**;
light edge/dark core **13.186:1**.
The three light app surfaces are real `ui/styles.css` values. The Windows strips
are representative flat backgrounds (#202020, #f3f3f3, #ffffff, #191919), not a
capture of the owner's desktop, wallpaper, translucency or high-contrast mode.

## At 16–24 px

The plain 16 px app drawing has 82 fully opaque shape pixels: 42 frame pixels
and 40 amber pixels, with a 3 × 3 transparent aperture. Its 2 px rails remain
pixel aligned. At 20 px the square rail is 2 px; at 24 px it is 3 px. Amber is
clearly coloured but its luminance boundary on white/off-white is weak (below
3:1). The adjacent dark frame anchors the whole silhouette; it does not improve
the square/background contrast. This is why the optional hairline is supplied,
particularly for a small standalone light-theme mark. It changes neither the
chosen amber colour nor the requested plain option. No remedy is silently applied.

Outlined Windows uses a **1 px outside edge at 16/20/24/32/40/48/64**, **2 px at
128**, **3 px at 256**. Contours are filled expanded silhouettes, then the dark
core is drawn on top; there is no centred half-pixel stroke or background tile.
The smallest upper bar and lower foot shorten by one pixel to keep a transparent
gap beside the square. At 16 px the core rails remain 2 px; its bright contour is
exactly 1 px and survives on dark backgrounds. On light backgrounds the dark core
carries the mark. The two measurement ticks return from 64 px, where the contour
has enough room; below that they would crowd the amber. At 256 px the light edge
is only 1.17% of the canvas, avoiding a heavy sticker appearance.

Mid-tone uses the same core geometry at each size, without the edge. At 16 px its
2 px #808080 rails are crisp and visible on all four review backgrounds (ratios
in the table), but its contrast against amber is lower than the dark core's.
The unoutlined amber has the same soft light-background boundary in both Windows
options. Neither choice can adapt to arbitrary taskbar colours or guarantee every
Windows theme. No real shell/taskbar acceptance is claimed.

## Recommendation

Use the requested plain, fixed-amber theme variants as the primary review mark;
inline currentColor is the practical single-file path for the app. If the small
light-theme square feels too soft at native size, choose the separate 0.5 px edge
alternative only for 16–24 px. **Recommend outlined for Windows**: it retains the
dark frame's stronger separation from amber, while its light edge preserves the
silhouette on dark surfaces. Mid-tone is a simpler alternative but feels flatter.
Ahmed's choice is still required before integration; this delivery supplies both.

## Reproduce and verify

From the repository root, with the already installed Node and Electron only:

`node assets/logo-gauge-2026-11-14/make-gauge.cjs`

`node assets/logo-gauge-2026-11-14/check-review.cjs`

The checker parses **all 36 SVG files** as XML with Chromium DOMParser, rejects
malformed/active/referenced content with negative fixtures, renders every SVG
through Chromium's SVG decoder onto a transparent canvas, and exports each of
the 18 Windows PNGs directly at its native size (no resizing or raster template).
It decodes every PNG again, checks dimensions, transparent margins, open apertures,
exact amber/frame pixels and Windows alpha alignment, then captures and decodes
all four review PNGs. It checks every inline SVG and PNG loads, currentColor on
both themes, exact displayed sizes, no page overflow at 390 px, and no attempted
network requests. Content Security Policy blocks active/external content. The
reviewer runs in a hidden isolated window, never the encoder application; cache,
crash and session paths are under a fresh OS temporary directory outside the repo.
No application tests were requested: application, source and packaging are untouched.
Claude re-runs any evidence it intends to cite in the project records.

## Originality and licence

This is **original artwork from the FFmpeg Encoder project**, derived solely
from its hand-authored selected Gauge candidate in
`assets/logo-candidates-2026-11-14/`, refined in this job. No tracing, stock art,
third-party logo geometry, AI raster artwork, downloads or external references.
The project ISC licence applies. The existing Folded Frame comparison retains
its own provenance in `assets/app-icon/PROVENANCE.md`. No logo ownership or
endorsement by FFmpeg, Electron or any other product is implied.
