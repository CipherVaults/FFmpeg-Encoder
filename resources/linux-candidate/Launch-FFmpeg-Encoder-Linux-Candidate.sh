#!/bin/sh
# Explicit internal candidate entry, not the production/default application.
set -eu
if [ "$#" -ne 0 ]; then
  printf '%s\n' 'This internal candidate launcher accepts no arguments.' >&2
  exit 64
fi
if [ -L "$0" ]; then
  printf '%s\n' 'Launch the ordinary candidate script, not a symbolic link.' >&2
  exit 64
fi
# Refuse Electron pre-main switches before they could bypass app loader checks.
if [ -n "${ELECTRON_RUN_AS_NODE+x}" ] || [ -n "${ELECTRON_FORCE_IS_PACKAGED+x}" ] ||
   [ -n "${ELECTRON_DISABLE_SANDBOX+x}" ] || [ -n "${NODE_OPTIONS+x}" ]; then
  printf '%s\n' 'Candidate launch refuses inherited runtime/security overrides.' >&2
  exit 64
fi
# Inspect names only; never print environment contents. Conservatively refuse
# every exported LD_ entry, including an empty one, without clearing it.
launcher_environment=$(/usr/bin/env)
case "
$launcher_environment" in
  *'
LD_'*) printf '%s\n' 'Candidate launch refuses inherited loader overrides.' >&2; exit 64 ;;
esac
unset launcher_environment
case "$0" in
  */*) launcher_dir=${0%/*} ;;
  *) printf '%s\n' 'Launch this script by its package-relative or absolute path.' >&2; exit 64 ;;
esac
launcher_dir=$(CDPATH='' cd -P "$launcher_dir" && pwd -P)
launcher_executable=$launcher_dir/ffmpeg-encoder-linux-candidate
if [ -L "$launcher_executable" ] || [ ! -f "$launcher_executable" ] || [ ! -x "$launcher_executable" ]; then
  printf '%s\n' 'Candidate executable must be an ordinary non-linked executable file.' >&2
  exit 64
fi
exec "$launcher_executable" --linux-unified-candidate
