# Concept A: Precision Aperture

Candidate app icon for FFmpeg Encoder, direction A ("precision"). Design review
only. Nothing here has been accepted, packaged or wired into the app.

## Meaning

A lens aperture, seen face-on, sits inside a measuring frame. The ivory ring is
the scale: a calibrated aperture with clean cuts at exactly 12 and 3 o'clock.
One quadrant of it is amber and stands slightly proud of the ring, like the
index band on a lens barrel. That is the one deliberate, understandable quality
choice the user makes. The teal square at the centre is the frame being worked
on, held still and exactly centred. It also stands for the protected output.
Two ivory corner marks (top-left and bottom-right) define a rectangle the way
a crop or measurement does, by two opposite corners. They read as care for the
source's bounds. Together the parts say "measured, exact, calm". No part shows
motion or play, because the app values safe, predictable work over speed.

## Palette

| Role | Hex | Notes |
|---|---|---|
| Tile (ink) | `#172A33` | Same tile as the current Folded Frame icon |
| Ring and corner marks (ivory) | `#F9F6EC` | 13.7:1 against the tile |
| Calibrated quadrant (amber) | `#F4B54C` | 8.2:1 against the tile; sits near the UI's `--orange #ffad42` |
| Centre frame (teal) | `#50C7BC` | 7.2:1 against the tile; links to the UI's green and the light theme's teal `#176b5c` |

This candidate keeps the existing icon palette unchanged, so it stays coherent
with `ui/styles.css` and with the Folded Frame icon it would replace. Against
the surfaces, the tile is 13.6:1 on the light review surface `#F3F5F7`. On the
dark surface `#101318` it is only 1.25:1, so on dark taskbars the ivory ring
gives the silhouette, as it does for the current icon.

## Construction (256 master, `icon.svg`)

- The canvas is the viewBox `0 0 256 256`, transparent outside the tile. The
  tile is `rect 8,8 240x240 rx 52`, the same footprint as the current icon.
- The aperture ring is centred on (128,128), with outer R 66 and inner r 48
  (18 px stroke). Parallel-sided 12 px gaps sit on the vertical and horizontal
  centre lines, so the cuts align exactly with the centre square's axes.
  - Ivory major arc: 270 degrees, clockwise from 3 o'clock to 12 o'clock.
  - Amber quadrant: the 12-to-3 o'clock quadrant. It shares the inner radius
    48, but its outer radius is 73 (raised 7 px, 25 px band).
- The centre square is teal, `rect 108,108 40x40 rx 4`.
- The corner marks are two L-shapes. Each has a 12 px stroke and runs 46 px
  from its outer corner, at 42 px (top-left) and 214 px (bottom-right). The
  outer bend radius is 18, concentric with the tile's corner arc (the tile
  corner centre is at (60,60), so 60 - 42 = 18). The inner bend shares that
  centre (radius 6), so the stroke width stays constant around the bend.
- Every shape is a filled `rect` or `path` using only `M/H/V/A/Z`. The file
  has no strokes, transforms, filters, gradients, fonts, text, scripts, links,
  `style` attributes, external references or raster images.

## Small optical sizes

`icon-16.svg`, `icon-24.svg` and `icon-32.svg` are hand-tuned grids. They are
not scaled copies of the master. The ring centre, the tile edges, the corner
mark edges, the gap edges and the square edges all fall on whole pixels, and
the ring radii are whole pixels.

| Size | Tile | Ring R / r / amber R | Gap | Corner marks | Centre square |
|---|---|---|---|---|---|
| 32 | 1..31, rx 7 | 9 / 6 / 10 | 2 px | 2 px stroke, 6 px arms, square bend | 6 x 6 |
| 24 | 1..23, rx 5 | 7 / 5 / 8 | 2 px | 1 px stroke, 5 px arms, square bend | 4 x 4 |
| 16 | 1..15, rx 3 | 5 / 3 / 6 | none | 1 px stroke, 3 px arms | 2 x 2 |

How the small sizes are simplified:

- The rounded, concentric bend of the corner marks becomes a square bend at 32
  and below. At those sizes a curve of 1 to 2 px would only blur into grey.
- The corner marks get lighter as the icon shrinks (master about 2.25 px at
  48, then 2 px at 32 and 1 px at 24 and 16). The ring and the amber band stay
  the dominant shapes, and the marks read as fine measuring ticks.
- At 16 px the 12/3 o'clock gaps are removed. The amber-to-ivory change of
  colour on the centre lines does the same job without a half-pixel cut. The
  raised amber band is kept (1 px proud), so the silhouette matches the larger
  sizes.
- The centre square sizes are chosen so that the ring, the dark gap and the
  square stay in clean steps of 2 to 3 px at each size.
- The optical PNGs are rendered at 1024 px and then area-averaged (Box filter)
  down to size. Pixel-aligned edges therefore come out fully crisp, without
  Lanczos ringing. `icon-48.png` and `icon-256.png` come from the 256 master
  using Lanczos, the same as the shipped generator. Both clear the one-level
  alpha fringe outside the tile.

## Files

- `icon.svg`: the 256 master.
- `icon-16.svg`, `icon-24.svg`, `icon-32.svg`: the optical sources.
- `icon-256.png`, `icon-48.png`: rendered from the master.
- `icon-32.png`, `icon-24.png`, `icon-16.png`: rendered from the optical
  sources.
- `preview-sheet.png`: every size at native pixels on dark `#101318` and light
  `#F3F5F7`, a taskbar-scale strip, and point-filtered enlargements of 16, 24
  and 32.
- `build.cjs`: rebuilds everything above. Run `node build.cjs` from this
  folder. It uses only Node built-ins and the installed ImageMagick 7, and it
  writes only into this folder.

## Originality statement

This geometry was authored from scratch for FFmpeg Encoder on 2026-10-30.
Every coordinate comes from the parameters in `build.cjs`. No logo, stock art,
icon set, font, glyph or reference image was imported or traced. It does not
resemble or reuse the FFmpeg logo (no zig-zag or stacked bars), the Electron
logo (no orbits or atom) or the Chrome/Chromium logo. To keep clear of
Chromium's ring-with-a-central-disc layout, the centre is a square, not a
circle, and the ring is a single split band, not coloured sectors. The icon has
no letters, no text and no play triangle. Corner marks around a circle are a
common generic "focus" pictogram, so this design avoids four symmetric corner
marks. It uses two diagonal marks, the raised calibrated quadrant and the
centred square as its distinguishing combination. No trademark search has been
performed. An owner review is still needed for final originality and
trademark clearance.

## Not established

Rendered PNGs on synthetic surfaces do not establish how the icon looks in the
real Windows taskbar, title bar or Alt-Tab view, or in a packaged executable or
ICO. No ICO was built for this candidate. Owner logo selection is a protected
gate.
