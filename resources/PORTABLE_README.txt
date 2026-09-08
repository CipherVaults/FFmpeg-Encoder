FFmpeg Encoder - local Windows x64 portable package

Extract the entire ZIP into a new, writable folder before opening
"FFmpeg Encoder.exe". Keep the executable, resources and other extracted files
together. The application stores its local data and batch logs in a "data"
folder beside the executable. A protected or read-only folder is unsuitable.

The package includes Electron, FFmpeg and ffprobe. Running it does not require
a global Node.js or FFmpeg installation. Encoding operates on local files.
NVIDIA profiles require compatible NVIDIA hardware and its installed driver;
the application tests the bundled encoders and reports available profiles.

Choose distinct input and output folders, select a profile and settings, then
review the batch before starting. Only supported top-level video files are
considered. Existing destinations are skipped. When two input names would
produce the same output, select one. Use a different output folder to retain
multiple quality variants of the same encoder-based name.

This version supports the documented SDR workflow. Detected HDR and ambiguous
color evidence are reported as unsupported. Extra media that cannot be
preserved is rejected with a reason. Bounded inspection cannot certify color
metadata that is missing, incorrect or outside the sampled frames.

Cancel stops the active operation and remaining queue. Wait for cancellation
and cleanup to finish before starting another batch or removing the drive.
Closing during work offers "Keep application open" or "Cancel encoding and
exit". Completed outputs remain available; encoding does not continue after
the application exits.

This is an unsigned package for the authorized local milestone. Compatibility
on a separate clean computer is not established merely by running an extracted
copy on the development computer. Public distribution is a separate decision.

Bundled notices and provenance:
  resources/binary-manifest.json
  resources/third-party/FFmpeg-LICENSE.txt
  resources/third-party/FFmpeg-README.txt
  LICENSE (Electron)
  LICENSES.chromium.html (Chromium and other Electron components)

FFmpeg's included full static build is identified as GPL-3.0-or-later in the
binary manifest. These notices and provenance are not a complete corresponding
source distribution or a written source offer. External distribution requires
its separate licensing review.
