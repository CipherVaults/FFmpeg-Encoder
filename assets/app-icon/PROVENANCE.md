# Folded Frame app icon

Original geometry authored for FFmpeg Encoder with Codex assistance on October 23,
2026. The source uses no imported logo, stock artwork, font, or reference image.
The icon does not reproduce the FFmpeg logo or the Electron/Chromium logo and does
not imply endorsement by those projects. The artwork and generator use the ISC
license, consistent with this repository's package metadata; see `LICENSE.txt`.

The three joined brackets suggest a media frame passing from source to output:
ivory for the source frame, amber for the folded transition, and teal for the
output frame. The ink tile gives the mark a consistent surface in light and dark
Windows/application themes. There is no text or play triangle. The source is an
editable, static SVG with filled geometry, transparency outside the tile, and no
scripts, links, fonts, filters, or external resources.

Palette: ink `#172A33`, ivory `#F9F6EC`, amber `#F4B54C`, fold `#D88D28`,
teal `#50C7BC`. SVG viewBox: 256 x 256. Each exported PNG is RGBA/sRGB.

Run `node scripts/generate-app-icon.cjs` from the repository root. The generator
uses Node built-ins and an already installed ImageMagick 7 `magick` executable;
it neither downloads tools nor opens an application. Optionally set
`APP_ICON_MAGICK` to the absolute path of an existing ImageMagick executable.
The generator reads `app-icon.svg`, renders one 1024px intermediate in memory,
then exports 16, 20, 24, 32, 40, 48, 64, 128, and 256px PNGs. At 16, 20, 24,
and 32px, explicit optical variants snap the three-part frame to whole-pixel
coordinates, strengthen the smallest bracket, and simplify the tiny fold. Their
editable SVGs are also retained. Larger sizes downsample the main source. It
clears any one-level alpha fringe from downsampling while retaining edge
anti-aliasing. It
assembles those exact PNG bytes into a multi-resolution ICO (PNG icon entries,
Windows Vista and newer), writes a light/dark review sheet, and records hashes in
`manifest.json`. No runtime, packaging, accepted artifact, or media file is
modified by this generator. The only output directory is `assets/app-icon/`.

The review sheet shows the exported PNGs at native pixel size on both surfaces,
plus 6x nearest-neighbor enlargements of 16, 20, 24, and 32px for edge inspection.
It is a design review aid. Rendered PNG and ICO structure validation does not
establish Windows shell, taskbar, titlebar, packaged executable, or owner visual
acceptance; those require the parent-owned native integration checks.
