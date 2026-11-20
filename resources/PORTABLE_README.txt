FFmpeg Encoder 0.6 Beta (0.6.0-beta.1) - Windows x64 portable package

Extract the entire ZIP into a new, writable folder before opening
"FFmpeg Encoder.exe". Keep the executable, resources and other extracted files
together. The application stores its local data and batch logs in a "data"
folder beside the executable. A protected or read-only folder is unsuitable.

The package includes Electron, FFmpeg and ffprobe. Running it does not require
a global Node.js or FFmpeg installation. Encoding operates on local files.
NVIDIA profiles require compatible NVIDIA hardware and its installed driver;
the application tests the bundled encoders and reports available profiles.

Choose input and output folders, select a profile and settings, then
review the batch before starting. Only supported top-level video files are
considered. Existing destinations are skipped. When two input names would
produce the same output, select one. Use a different output folder to retain
multiple quality variants of the same encoder-based name.

On verified local fixed NTFS storage, input and output may be the same folder.
Recognized generated outputs stay excluded by default. "Re-encode this output"
explicitly admits only the chosen unchanged file for the current preparation;
another lossy generation can reduce quality. "Treat as original" instead
corrects ambiguous legacy filename classification. Existing outputs/originals
remain protected. Do not open a mixed collection in the older 0.5 application,
which cannot recognize the new generated-output provenance.

Folders and per-profile settings are remembered locally after validation.
Missing locations or unavailable hardware remain visible; there is no automatic
encoding or silent encoder fallback. Unchanged files on eligible storage reuse
inspection evidence. Forget preferences and Clear cache are independent and do
not erase media or provenance. Use a separate extraction/state folder for rollback.

Expert preset and CRF/CQ controls remain editable. Hover or keyboard-focus help
to inspect what a control contributes, and expand prepared-file details for
the actual main-owned FFmpeg argument array. Before launch, only its protected
temporary output path is a clearly labelled placeholder; this is not a shell
command for copying into a terminal.

Tested Default remains separate from Archive Quality - Ada/Blackwell NVENC.
The HEVC Archive helper applies P7, UHQ, full-resolution multipass, VBR-CQ29,
four B frames and B-reference mode each, preserving supported source depth.
It is capability-gated and fully inspectable. Manual preset/CQ edits remain
visible; Use standard options clears the compound options. Quality and size
vary by scene. CQ and CRF are not equivalent. Local Blackwell benchmark evidence
does not establish Ada quality/speed or a universal filesize/quality guarantee.

This version supports the documented SDR workflow. Detected HDR and ambiguous
color evidence are reported as unsupported. Extra media that cannot be
preserved is rejected with a reason. Bounded inspection cannot certify color
metadata that is missing, incorrect or outside the sampled frames.

MP4 track creation timestamps are preserved as SOURCE_CREATION_TIME on the
corresponding Matroska tracks; file details explain this representation.
Conflicting metadata is refused. Source-identity errors name changed fields
and retain comparison details in local logs. Matching sparse samples cannot
prove unchanged full content, so even a metadata-only change can require
fresh preparation. Original files and existing completed outputs stay protected.

Cancel stops the active operation and remaining queue. Wait for cancellation
and cleanup to finish before starting another batch or removing the drive.
Closing during work offers "Keep application open" or "Cancel encoding and
exit". Completed outputs remain available; encoding does not continue after
the application exits.

This is an unsigned public Beta prerelease. Windows may warn before running it;
compare the file with the SHA-256 checksum published on the release page instead
of bypassing a warning you cannot verify. The Beta was tested in a clean, offline
Windows Sandbox profile with CPU encoding. NVIDIA encoding, real folder dialogs
and SmartScreen were not tested for this build.

Bundled notices and provenance:
  resources/binary-manifest.json
  resources/third-party/FFmpeg-LICENSE.txt
  resources/third-party/FFmpeg-README.txt
  LICENSE (Electron)
  LICENSES.chromium.html (Chromium and other Electron components)

The bundled FFmpeg 9.1 and FFprobe were built from source for this release and
are licensed GPL-3.0-or-later (see FFmpeg-LICENSE.txt). FFmpeg-README.txt lists
every library linked into them with its version and license. The complete
corresponding source - the unmodified upstream archives of FFmpeg and each
linked library plus the exact build scripts - is a separate download on the
release page: https://github.com/CipherVaults/FFmpeg-Encoder/releases/tag/v0.6.0-beta.1
