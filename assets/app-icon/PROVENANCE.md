# Gauge app artwork

Ahmed approved the theme-aware Gauge header and the mid-tone Windows icon on
November 21, 2026, after reviewing both live workbench themes. The original Gauge
paths and independently drawn Windows sizes are recorded in
`assets/logo-gauge-2026-11-14/`. The FFmpeg Encoder contributors license the
artwork under ISC. See `LICENSE.txt`.

The inline header uses the open frame and ticks from
`gauge-app-currentcolor.svg`. Their color follows the workbench theme. The
output square stays amber (`#ffad42`) in both themes. The Windows frames use
neutral gray (`#808080`) and the same amber, with a transparent background.

Run `node scripts/generate-app-icon.cjs` to assemble the Windows assets from
the reviewed SVG and PNGs. Each input must match the recorded SHA-256 in the
artwork verification record. The ICO contains the exact PNG bytes at 16, 20,
24, 32, 40, 48, 64, 128 and 256 px. Run the same command with `--check` for a
read-only comparison of the shipped files and their generation manifest.

The older per-size `app-icon-*.svg`, PNGs of sizes other than 256, and
`review-sheet.png` are retained Folded Frame design records excluded from
packaging. Their original generator, provenance and manifest are available at
commit `7c1c56dfcd637ce46c760d683747a80dc9aeb85c`. Windows shell and
packaged-executable appearance have their own native checks.
