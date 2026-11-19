FFmpeg Encoder Linux Candidate — internal, exact-host build

This is NOT a public v0.7 release or a portable Ubuntu/Mint build.
After separate artifact audit and authorized normal executable-mode finalization,
run electron/Launch-FFmpeg-Encoder-Linux-Candidate.sh by its explicit path.
The launcher accepts no arguments and starts only the existing unified candidate.
It does not download, install, change settings, enable a sandbox bypass, or alter
the app's production default. Do not launch the raw executable without its flag.

Settings/session state use the existing Electron appData directory's
FFmpegEncoder-Linux-Unified-Candidate folder. This is deliberately the SAME
candidate profile across normal launches, not a fresh profile per launch and not
portable state beside the executable. Existing single-instance ownership applies.
The launcher does not copy or migrate other app profiles. The launcher rejects even empty inherited Electron security/runtime overrides, NODE_OPTIONS
and every exported LD_ entry before launching; it does not erase them. Existing
app loader checks remain in force.

Current admission remains restricted: fixed CPU H264 ordinary encoding, selected
measured H265 operations, and narrow full MP4 remux. CPU AV1 is not exposed by this
candidate merely because its runtime can encode AV1. Unsupported settings must
remain unavailable/refused; consult the app's candidate notices. No GPU, general
codec/container coverage, clean-host compatibility or release readiness claim.

The inert builder still creates every file without executable permissions.
CANDIDATE_FINALIZATION.json specifies the exact six ordinary 0755 paths for a
later separately authorized internal launch. Every other file stays 0600; never
set setuid/setgid or disable sandbox/security checks. Do not modify app source,
FFmpeg, dependency or notice bytes. Keep the original inert inventory/audit and
record a separate finalization receipt including all hashes and modes. Preserve
NOT_FOR_DISTRIBUTION.txt. A launcher is not a distribution approval.

Environment checks run AFTER the shell interpreter starts. They cannot prevent
loader influence on the interpreter or /usr/bin/env itself. Launch only from the
reviewed normal environment. Artifact auditing supplies byte identity; ordinary
file checks are not protection from hostile concurrent file substitution.
