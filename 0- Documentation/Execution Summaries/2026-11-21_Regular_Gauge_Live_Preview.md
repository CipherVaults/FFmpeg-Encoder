# Gauge live workbench preview

## Exact display evidence

On source checkpoint `7c1c56dfcd637ce46c760d683747a80dc9aeb85c`, the pinned Windows Electron 44.7.0 displayed the selected Gauge in the live regular workbench. A private copy changed the header artwork and capture settings. The existing renderer, theme selector, application protocol, preload and appearance storage handled the display and theme switch. The test used a CPU capability fixture and blocked every Node child-launch API. It observed zero tool launch attempts. The Electron session closed cleanly.

The 28 px mark used `#edf0f4` for the dark-theme frame and `#1c2925` for the light-theme frame. Both used the same `#ffad42` square. Light was read back from the isolated saved appearance file after close.

| Capture | SHA-256 |
| --- | --- |
| Dark workbench | `82d5be265cc2cbf9a0b7d02f8e43aed6ad9ec717a2c39d81b6730e37f8fd1ba4` |
| Light workbench | `c1b896fabc9b78fdd3744431924b6bd001fef84e4c2f7b1aeb6ba475dd88c157` |
| Preview receipt | `21d047b11bc9b9dbf54ba3122c93c0dfeed838246b1a336b36dcbb2731256579` |

The first hidden capture timed out in the Playwright page screenshot. It closed with no media or remaining Electron process and its failure was retained. A separate offscreen run used Electron native capture and produced both images. These images cover the live workbench at one tested viewport. At the preview checkpoint, the mid-tone Windows artwork awaited the owner’s integration approval.

## Owner approval and integration

Ahmed approved the theme-aware header and mid-tone Windows icon on November 21.
The regular workbench uses the three reviewed paths with explicit closing tags,
and Help credits the Gauge artwork under its existing ISC license. The existing
Window and Packager paths read the new nine-size ICO. The assembled ICO is
5,531 bytes with SHA-256
`75ec15164d2cb75ad84344102ca23f16972ebd4a21211fc7ad12eda0245be2db`.
All nine embedded PNGs match the reviewed source hashes. The current inert
Linux inventory's 192 source files match their recorded checksums.

The first combined controlled run exposed a fixture parser restriction on
self-closing SVG paths. It also retained two platform-specific Linux build
assertion failures on Windows and an older Remux export checksum mismatch.
The final renderer and Windows packaging receipt `r-win-gauge-final` passed
130 checks. Six separate inert Linux source and package-plan checks passed
on Windows.

Fresh Electron 44.7.0 capture of the exact integrated HTML confirmed both
28 px marks and the fixed amber square. Electron decoded the ICO at 256 px.
Both captures and the saved Light setting were read back with zero tool launch
attempts and zero remaining owned processes. The capture receipt SHA-256 is
`56414674a91284b79ff148da5faea21ac0e5fe7b7fa85cc0ab55c5119c6c18a8`.
Windows taskbar and packaged executable checks remain for the native package.
