<p align="center"><img src="docs/readme/gauge-icon.png" width="82" alt="FFmpeg Encoder Gauge icon"></p>

# FFmpeg Encoder

**Batch-encode videos on your own PC, without writing FFmpeg commands.**

FFmpeg Encoder is a desktop interface for [FFmpeg](https://ffmpeg.org/). Point it at a folder of clips, choose how to encode them, and review the batch before you start. FFmpeg does the encoding on your computer; there is no upload step.

**[Download Windows installer](https://github.com/CipherVaults/FFmpeg-Encoder/releases/download/v0.6.0-beta.1/FFmpeg-Encoder-0.6.0-beta.1-Setup-win32-x64.exe)** · **[Download portable ZIP](https://github.com/CipherVaults/FFmpeg-Encoder/releases/download/v0.6.0-beta.1/FFmpeg-Encoder-0.6.0-beta.1-win32-x64.zip)** · [Release notes](https://github.com/CipherVaults/FFmpeg-Encoder/releases/tag/v0.6.0-beta.1)

> **Available now: v0.6 Beta for Windows x64.** Both downloads bundle FFmpeg 9.1 and FFprobe. No separate FFmpeg install is needed. Windows may warn because these builds are unsigned; compare your file with the [published SHA-256 checksums](https://github.com/CipherVaults/FFmpeg-Encoder/releases/download/v0.6.0-beta.1/SHA256SUMS.txt).

## Visual preview

![FFmpeg Encoder v0.7 development workbench showing folder pickers, encoder controls, and a file inspector](https://ahmed-selected-work.ahmedessam5500.chatgpt.site/images/ffmpeg-workbench-gauge.svg)

*Graphite workbench from v0.7 Linux development. This is a real app capture with Gauge artwork applied for the preview; the Windows v0.6 Beta download has a different layout.*


## What you can do in v0.6 Beta

| | |
| --- | --- |
| **Encode a folder of clips** | Batch-process supported SDR video into MKV with H.264, H.265 (HEVC), or AV1. Use your CPU or a supported NVIDIA GPU. |
| **Check the batch before encoding** | See what's ready, what needs attention, and which files will be skipped. Expand a prepared file to see the actual FFmpeg arguments. |
| **Keep more than the picture** | Preserve compatible audio, subtitles, chapters, attachments, and metadata. The app flags cases it cannot safely handle. |
| **Protect your originals** | Existing destinations are not replaced. On supported local NTFS drives, you can write beside the originals; recognized outputs are excluded from the next batch by default. |
| **Spend less time setting up repeat jobs** | The app remembers folders and per-profile settings. On eligible local drives, it can reuse inspection results for unchanged files. |

## Try your first encode

1. **Install or extract.** The installer sets up the app for your Windows account. For portable use, extract the entire ZIP to a new writable folder and open **FFmpeg Encoder.exe**. Keep its files together.
2. **Pick your folders and profile.** Start with separate input and output folders and an **H.264 CPU** profile. Select a short SDR clip.
3. **Review, encode, and play the result.** Check the batch preview before you start. Verify the new MKV before processing a larger folder.

**Beta scope:** Windows x64 and SDR video. NVIDIA encoding was tested on one RTX 5060; it requires a compatible GPU and driver. AMD/Intel hardware encoding, HDR conversion, Linux packages, and the v0.7 workspaces are not part of this download. See the [release notes](https://github.com/CipherVaults/FFmpeg-Encoder/releases/tag/v0.6.0-beta.1) for known issues, the changes since v0.5, and what was tested.

## Source, licensing, and feedback

- **Released app source:** [v0.6.0-beta.1 tag](https://github.com/CipherVaults/FFmpeg-Encoder/tree/v0.6.0-beta.1) · [changelog](https://github.com/CipherVaults/FFmpeg-Encoder/blob/v0.6.0-beta.1/CHANGELOG.md). The default branch contains v0.7 development source and is not the Beta build.
- **Bundled engine:** FFmpeg 9.1 is a separate component under GPL-3.0-or-later for this build. The [matching engine source and build materials](https://github.com/CipherVaults/FFmpeg-Encoder/releases/download/v0.6.0-beta.1/FFmpeg-Encoder-0.6.0-beta.1-ffmpeg-9.1-source.zip) and [third-party notices](https://github.com/CipherVaults/FFmpeg-Encoder/blob/v0.6.0-beta.1/resources/third-party/FFmpeg-README.txt) are separate from this UI's source. A license file for the app itself has not been published.
- **Feedback:** Include the app version, Windows version, and encoding profile. Remove personal filenames and paths from any logs you share. [Project portfolio](https://ahmed-selected-work.ahmedessam5500.chatgpt.site/) · [All releases](https://github.com/CipherVaults/FFmpeg-Encoder/releases).
