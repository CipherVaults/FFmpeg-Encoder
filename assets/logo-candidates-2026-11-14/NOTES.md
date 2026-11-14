# Six original logo candidates

Created November 14, 2026 for FFmpeg Encoder, requirement R07. These are review
candidates: Claude reviews theme fit, then Ahmed selects. The shipped Folded Frame
icon is unchanged. No candidate is connected to application or packaging code.

All six candidates are **original artwork created in this job**. Their geometry
was drawn by hand as SVG path data, with no tracing, reference artwork, stock
icons, image generation, third-party assets, font downloads or embedded fonts.
Simple frame, cut and signal vocabulary describes this app's work; no FFmpeg
project logo geometry or other product identity was used. The words “FFmpeg
Encoder” appear as live text in lockups. Candidate artwork is offered under the
repository's ISC licence. The existing comparison icon retains its separate
provenance in `assets/app-icon/PROVENANCE.md`.

## Palette and file convention

Exact values come from `ui/styles.css`; the historical token name `--orange` is
also the light theme's teal action colour. None of the palette was redesigned.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--text` | `#edf0f4` | `#1c2925` | Neutral structure and live wordmark |
| `--orange` | `#ffad42` | `#176b5c` | Transform, retained core, cut, check, E rail or signal |
| `--surface` | `#181d24` | `#ffffff` | Actual theme review surfaces |
| `--background` | `#101318` | `#f7f7f4` | Page / available surrounding theme background |
| `--inset` | `#202630` | `#f0f3f1` | Existing theme token retained in preview CSS |
| `--border` | `#343e4a` | `#b9c5c0` | Review panel separators |
| `--muted` | `#b1bdcb` | `#4d6057` | Review captions |

Every candidate uses **only `--text` and `--orange` in the artwork itself**. It has
transparent space around and inside the mark, without a shared rounded tile.
Both colours have substantial contrast against their corresponding theme's
surface, background and inset; a separate treatment is supplied because the dark
neutral would disappear on the opposite dark surface, and the pale neutral
would disappear on white. Colour communicates emphasis, not essential geometry.
Monochrome uses only `currentColor`, including all cutouts as open negative space.

Each name has ten SVG files:

- `NAME-mark.svg`: dark-default square master, `viewBox="0 0 256 256"`.
- `NAME-mark-dark.svg` / `NAME-mark-light.svg`: explicit colour treatments.
- `NAME-mark-16.svg`: dedicated optical drawing, `viewBox="0 0 16 16"`.
- `NAME-mark-16-dark.svg` / `NAME-mark-16-light.svg`: optical treatments.
- `NAME-mono.svg`: one-colour 256-grid drawing using `currentColor`.
- `NAME-lockup.svg`: dark-default live-text horizontal signature.
- `NAME-lockup-dark.svg` / `NAME-lockup-light.svg`: lockup treatments.

Unsuffixed colour files are byte-identical to their explicit dark counterparts.
The 16-grid source is intentionally used for both 16 and 24 px in the preview;
the master is used at 32, 48, 128 and 256 px. All small paths have integer
coordinates and use filled geometry rather than fragile centred strokes. At
24 px these integer source positions scale by 1.5, so some edges antialias.
Lockups use the system stack `Segoe UI Variable, Segoe UI, system-ui, sans-serif`,
with no font assets. Glyph appearance can vary with the local system. The mark
is always geometry, including the monogram.

## Gauge — resize / transform

**Idea:** A large source frame steps down into a smaller, precisely aligned output.

- **Tokens:** `--text` draws the source corners and two measurement ticks;
  `--orange` draws the smaller output frame. The same token roles apply in light.
- **At 16 px:** The ticks disappear. Two-pixel rails and an open 3 × 3 px output
  aperture retain the source-to-output relationship. The two source corners and
  small square are separately readable without a fine arrow or a play triangle.
- **Weakness:** Its clearest association is resize or crop, so the complete app
  name is needed to communicate encoding and remuxing. The deliberately open
  source frame can look like a selection tool.
- **Rank 1:** The most distinctive balance of media geometry and careful
  engineering. It remains compact, has a clear mono silhouette and fits both
  palettes without a generic verification badge.

## Sleeve — container / remux

**Idea:** An open wrapping sleeve changes the container while a central media core stays intact.

- **Tokens:** `--text` draws the upper/left wrapper; `--orange` draws the closing
  right wrapper and unchanged rectangular core.
- **At 16 px:** The core becomes a 4 × 3 px block. Two-pixel wrapper edges and the
  open seam keep the three parts apart. Diagonal sleeve edges antialias, while
  the core stays aligned to whole pixels.
- **Weakness:** It can suggest a parcel, archive utility or hardware enclosure
  before video. Its volume suggests wrapping more strongly than trimming.
- **Rank 4:** A useful, genuinely different container-led direction with a
  strong silhouette, but less immediately recognisable as a video tool.

## Splice — precise trim

**Idea:** A slanted, open cut separates two film-strip ends without losing their frame rhythm.

- **Tokens:** `--text` draws the left segment; `--orange` draws the right segment
  and the master's two small registration bars.
- **At 16 px:** Registration bars are removed. The two broad rails, open windows
  and diagonal two-pixel separation do the work; tapered aperture tips naturally
  antialias. No scissors, tiny perforations or hairline cut is required.
- **Weakness:** It privileges editing over encode/remux and can resemble two
  slanted mechanical parts. The right aperture is intentionally smaller, so it
  is less balanced than Gauge at very small sizes.
- **Rank 3:** The most energetic direction and an effective cut metaphor. Its
  diagonal rhythm is recognisable, though less calm than the top two choices.

## Witness — checked result

**Idea:** An open inspection frame closes through a check, making verification part of the frame itself.

- **Tokens:** `--text` draws the inspection frame; `--orange` draws the check.
- **At 16 px:** Corners simplify to integer bevels, the frame keeps two-pixel
  rails and the check uses a broad diagonal. Its tip approaches the upper-right
  boundary while the open right side keeps the frame from swallowing it.
- **Weakness:** A check can read as a general task, backup or security tool. It
  is a brand metaphor for this app's checks, not a claim of universal correctness,
  certification or verified hardware support.
- **Rank 2:** Best expression of the app's “every result checked” promise and
  the easiest to read quickly. It ranks below Gauge because check/frame marks
  are common visual vocabulary even when the exact geometry is original.

## Lattice — abstract FE

**Idea:** Two machined rails form an abstract FE monogram, with a shared central working line.

- **Tokens:** `--text` draws the F rail; `--orange` draws the E rail.
- **At 16 px:** Two-pixel stems, two-pixel crossbars and a clear central channel
  preserve both letters. The F's shortened middle bar leaves breathing room
  beside the E. These letters are paths, not text or a font-derived outline.
- **Weakness:** The initials alone do not say video and can feel like a technical
  component vendor. Its symmetry is quieter but less memorable than Gauge.
- **Rank 5:** The cleanest typographic option and strong in mono; it needs the
  full lockup to explain the app and offers less useful product meaning.

## Cadence — sound / timing / picture

**Idea:** A measured signal crosses a video frame, linking sound, timing and picture.

- **Tokens:** `--text` draws the two frame caps; `--orange` draws the continuous
  signal, whose low excursion meets the lower frame.
- **At 16 px:** The signal becomes a broad asymmetric pulse; frame caps remain
  two pixels thick. The intentionally joined low excursion is part of the
  silhouette, while the left and right entries stay visible through frame gaps.
- **Weakness:** A pulse can be mistaken for medical monitoring or an audio-only
  editor. It has the busiest small silhouette of the six, especially in mono.
- **Rank 6:** Relevant to audio/video timing, with a very different profile, but
  weaker product identification and more visual noise than the other options.

## Review and verification

Open `preview.html` directly from disk. All six concepts appear at **16, 24, 32,
48, 128 and 256 px on both actual theme surfaces**, with mono samples, live-text
lockups and a side-by-side 32 px comparison to the shipped icon. A full baseline
also shows the current icon at all six sizes. All artwork is inline; the page has
no scripts, images, external fonts, stylesheets or network resources. A restrictive
CSP reinforces this. It is a static review page, with internal jump links only.

Reproduce and check from the repository root, using already installed tools:

```powershell
node assets/logo-candidates-2026-11-14/make-candidates.cjs
powershell -NoProfile -File assets/logo-candidates-2026-11-14/check-xml.ps1
node assets/logo-candidates-2026-11-14/check-review.cjs
```

`make-candidates.cjs` contains the original hand-authored geometry. It writes the
60 SVGs and preview only in this folder. It reads the existing shipped SVGs for
inline comparison and does not rewrite them.

`check-xml.ps1` parses every SVG with .NET's XML parser and DTDs disabled. Its
four negative fixtures check malformed XML, a forbidden DTD, a wrong root and a
missing namespace. `check-review.cjs` rejects resource references, scripts,
foreign content, events, styles and non-token colours, with ten negative
fixtures; it also checks integer optical coordinates, dimensions, live text,
monochrome fills and dark-default alias equality.

The review uses **the already installed Electron/Chromium runtime in a hidden
window**, loading this preview from a `file:` URL without the application. It
parses all SVGs again with Chromium's XML parser, measures all twelve theme
panels and their six sizes, checks the real surface colours, and checks narrow
390 px reflow. The request interceptor refuses anything except the local review
file and in-memory data URLs, and records any attempted external requests.

`small-size-review.png` contains native **16 and 24 px browser rasters**, plus
**6× nearest-neighbour enlargements of the actual 16 px pixels**. Each optical
mark is first drawn into a 16 × 16 canvas; that bitmap, rather than the vector,
is enlarged without smoothing. This makes dropped apertures, merged rails and
antialiasing visible. Rendering is forced to a device scale factor of 1 so native
16 px samples occupy 16 physical pixels, independent of the desktop's scaling.
The six `review-NAME.png` files preserve each comparison
panel; `review-overview.png` preserves the top of the review. `verification.json`
records renderer versions, dimensions, offline checks and SHA-256 hashes of the
SVGs, preview, notes and QA sources. Temporary Electron state stays in this
folder's `.qa-electron-state/` while running and can be discarded afterwards.

Completed review: all 60 SVGs parsed in both .NET and Chromium, all 14 negative
fixtures were refused, all twelve panels measured correctly at all six sizes,
and the page attempted zero external requests. The 390 px layout had no
horizontal page overflow. I visually inspected the small-size sheet and all
six concept captures on both surfaces: Gauge's square opening survives, Sleeve's
core remains separate, Splice retains both tapered openings, Witness keeps a
recognisable check, and Lattice reads as FE. Cadence's low junction is visibly
heavier, consistent with its last-place ranking. No geometry was changed after
these observations.

This is local SVG/rendering/design verification. It does not establish Windows
taskbar, shell, ICO export, packaging, independent-machine or owner visual
acceptance. A transparent mark may need a chosen tile when later integrated;
that remains a separate design decision after Ahmed selects a concept.
