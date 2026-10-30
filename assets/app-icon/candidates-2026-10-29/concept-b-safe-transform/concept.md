# Concept B: Kept Frame

Candidate ID: `concept-b-safe-transform`. Direction B is "safe transformation". This is an unaccepted design candidate. Ahmed decides which logo is selected.

## Meaning

A complete ivory video frame (the source) slides in from the left into an open bracket. The bracket is one continuous band. It starts amber along the top, which is the transform at work. At the top-right corner it folds over a 45-degree crease. After the fold, the band shows its other face: teal, which is the finished output. That face runs down the right side and back along the bottom. The band surrounds the source but never touches it. The clear ink gap all the way round stands for the app's protection rule: the job reads the original and builds the output beside it, and it never cuts, covers or overwrites the source. The design reads left to right: source, then the amber transform, then the fold, then the teal output. It keeps the Folded Frame's material ideas (a frame, amber turning to teal, a fold). What changes is that the ivory is now a closed, separate frame instead of one bracket of a shared frame, and the fold is now the point where the band changes into the output.

## Palette

| Role | Hex | Note |
|---|---|---|
| Tile (ink) | `#172A33` | Same as the current Folded Frame |
| Source frame (ivory) | `#F9F6EC` | Same as the current Folded Frame |
| Transform face (amber) | `#F4B54C` | Same as the current Folded Frame; close to UI `--orange #ffad42` |
| Output face (teal) | `#50C7BC` | Same as the current Folded Frame; sits between UI `--green #98d5b2` and light-theme `--orange #176b5c` |
| Crease flap (deep teal) | `#2E978E` | New: the teal underside in shadow at the fold. It replaces the old darker amber `#D88D28` |

The ink tile keeps the mark on its own surface. On a dark taskbar or a `#101318` background, the ivory, amber and teal carry the shape. On a light taskbar or a `#F3F5F7` background, the tile edge carries it. The palette has not been changed, so the candidate stays consistent with `ui/styles.css` in both themes.

## Construction (256 master, `icon.svg`)

- Tile: `rect 8,8 240x240 rx52`. Transparent outside the tile.
- Content box: x 40-216, y 52-204, centred on (128,128).
- Band: thickness 24, from x 104 to 216 and from y 52 to 204.
  - Amber top arm: `104..192 x 52..76`.
  - Crease flap: triangle (192,52) (216,76) (192,76). This is a real strip fold. The outer corner triangle is removed as a chamfer, and the folded part lies over the inner half of the corner square, showing the band's underside.
  - Teal right side and bottom arm. The outer bottom-right corner has radius 24 and the inner corner is square. The arm ends are square.
- Source frame: `x40 y86 w114 h84`, outer radius 16, band 22. The window is 70x40, close to 16:9, with radius 4. One even-odd path is used.
- Clearance: 10 units between the frame and each arm, and 38 units to the output side. The frame's right half sits inside the band opening, so it reads as "passing in".
- Only five filled shapes are used: no strokes, text, fonts, filters, gradients, scripts, links or embedded raster images. All edges are horizontal, vertical or 45 degrees, plus two kinds of rounded corners.

## Small sizes

`build.cjs` draws every size with the same routine, so the optical SVGs use the same construction re-gridded to whole pixels. They are not separate artwork. The script asserts the following at every size:

- the source frame clears both arms by at least 1 px and the output side by at least 1 px
- the frame window stays open
- the frame sits across the band opening
- every edge coordinate is an integer

| Size | Band | Frame band | Frame window | Clearance (arm / side) | Notes |
|---|---|---|---|---|---|
| 32 (`icon-32.svg`) | 3 px | 3 px | 8x4 | 2 px / 5 px | Frame corner radius 2, window square |
| 24 (`icon-24.svg`) | 2 px | 2 px | 7x4 | 1 px / 3 px | Frame corner radius 1.5 |
| 16 (`icon-16.svg`) | 2 px | 2 px | 4x2 | 1 px / 2 px | Content is enlarged to a 1 px tile margin, the frame is thickened so it does not go thin, and the fold becomes a 2x2 chamfer |

Simplifications:

- The window radius is removed below 256.
- The fold keeps its chamfer and flap colour at every size, so amber turning into teal is still visible at 16 px.
- 48 and 256 are downsampled from the master through a 1024 px intermediate (Lanczos).
- 16, 24 and 32 are rendered from their optical SVGs at 8x and Box-averaged. This makes each pixel's coverage the exact area of the whole-pixel geometry, so it has no ringing.
- A one-level alpha fringe is cleared, as in the existing generator.

## Files

- `icon.svg` is the 256 master. `icon-32.svg`, `icon-24.svg` and `icon-16.svg` are the optical sources.
- `icon-256.png` and `icon-48.png` come from the master. `icon-32.png`, `icon-24.png` and `icon-16.png` come from the optical SVGs. All are RGBA/sRGB.
- `preview-sheet.png` shows all sizes at actual pixels on dark `#101318` and light `#F3F5F7`, plus nearest-neighbour enlargements (32 x6, 24 x8, 16 x12). It is a design review aid only.
- `build.cjs` regenerates everything in this folder only (`node build.cjs`, ImageMagick 7, optional `APP_ICON_MAGICK`).

## Originality statement

The geometry was authored from scratch for FFmpeg Encoder on 2026-10-30. Its only reference was the project's own Folded Frame (its palette and its fold-as-transition idea). The candidate does not use, trace or reproduce:

- the FFmpeg logo
- the Electron or Chromium logos
- any other trademark, stock artwork or icon set
- any font, letterform, digit or text glyph
- a play triangle

The only shapes are rounded rectangles, rectangles and right triangles. It does not imply endorsement by any project. Rendered PNG checks do not establish Windows shell, taskbar, ICO or packaged-executable behaviour, or owner acceptance.

## Known weaknesses (honest assessment)

- The bracket with a dog-eared top-right corner echoes the generic "document with folded corner" glyph. It can read as "frame goes into a file". That matches the meaning, but it makes the mark less unique.
- The silhouette is wider than it is tall, a frame plus a "]" shape. At a glance it can look like a generic "window and bracket" UI glyph, or like a battery or cassette outline, rather than a strong brand shape.
- At 16 px the content fills the tile to a 1 px margin. This is denser than the current Folded Frame (3 px margin). The fold is only about two partly covered pixels and reads as a dark notch, not as a fold. The ivory window is 4x2.
- The deep-teal flap `#2E978E` is fairly close to the ink tile in luminance on some displays. Its contrast was judged by eye only and was not measured.
- It is close to the Folded Frame in palette and layout (amber top-right, teal bottom-right). That is good for continuity, but it may be too close to count as a fresh identity.
- Only ImageMagick (librsvg 2.40) renders were inspected. The candidate was not tested on a real Windows taskbar, title bar, high-DPI scaling or ICO packaging.
