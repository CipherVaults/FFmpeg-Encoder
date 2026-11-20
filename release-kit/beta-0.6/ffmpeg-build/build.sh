#!/usr/bin/bash
# FFmpeg Encoder 0.6 Beta engine: static FFmpeg 9.1 for Windows x64.
# Runs only inside a disposable, network-less Windows Sandbox. guest.ps1 has
# already checked every input's size and SHA-256 and unpacked the tools.
# No upstream source is patched. Mode "verify" checks the FFmpeg release
# signature offline; mode "build" builds the libraries, FFmpeg and receipts.
set -euo pipefail
export LC_ALL=C
MODE=${1:?mode}
B=/c/b; W=C:/b; IN=/c/in; OUT=/c/out; JOBS=12
LLVM=$W/t/llvm-mingw-20261104-ucrt-x86_64
export PATH="/c/b/t/llvm-mingw-20261104-ucrt-x86_64/bin:/c/b/t/cmake-3.31.12-windows-x86_64/bin:/c/b/t/ninja:/c/b/t/python:/c/b/msys64/ucrt64/bin:/c/b/msys64/usr/bin:/c/Windows/System32:/c/Windows"
export TMPDIR=/tmp TMP=C:/b/tmp TEMP=C:/b/tmp
mkdir -p /tmp /c/b/tmp "$OUT/logs"
phase() { printf '%s' "$1" > "$OUT/phase.txt"; printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$OUT/logs/phases.log"; }
log() { local n=$1; shift; "$@" >> "$OUT/logs/$n.log" 2>&1; }

if [ "$MODE" = verify ]; then
  phase ffmpeg-signature
  export GNUPGHOME=$B/gnupg; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
  # Keyring holds only the keys in the staged ffmpeg-devel.asc. The pinned
  # primary fingerprint must appear as the VALIDSIG primary-key field.
  gpg --batch --no-autostart --yes --dearmor -o "$B/ffmpeg-keyring.gpg" "$IN/ffmpeg-devel.asc"
  gpgv --keyring "$B/ffmpeg-keyring.gpg" --status-fd 1 "$IN/ffmpeg-9.1.tar.xz.asc" "$IN/ffmpeg-9.1.tar.xz" > "$OUT/logs/gpgv-status.txt" 2> "$OUT/logs/gpgv-stderr.txt"
  grep -Eq '^\[GNUPG:\] GOODSIG ' "$OUT/logs/gpgv-status.txt"
  grep -Eq '^\[GNUPG:\] VALIDSIG [0-9A-F]{40} .* FCF986EA15E6E293A5644F10B4322F04D67658D8$' "$OUT/logs/gpgv-status.txt"
  if grep -Eq '^\[GNUPG:\] (BADSIG|ERRSIG|EXPKEYSIG|REVKEYSIG|EXPSIG|NO_PUBKEY) ' "$OUT/logs/gpgv-status.txt"; then exit 3; fi
  { gpg --version | head -1; gpgv --version | head -1; } > "$OUT/logs/gpg-versions.txt"
  echo verified > "$OUT/signature-ok.txt"
  exit 0
fi
[ "$MODE" = build ] || exit 2

PREFIX=$W/prefix; P=$B/prefix; S=$B/src
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig
unset PKG_CONFIG_PATH || true
export CC=x86_64-w64-mingw32-clang CXX=x86_64-w64-mingw32-clang++ AR=llvm-ar RANLIB=llvm-ranlib NM=llvm-nm STRIP=llvm-strip WINDRES=x86_64-w64-mingw32-windres
mkdir -p "$P/lib/pkgconfig" "$P/include" "$OUT/pe" "$OUT/bin" "$OUT/info" "$OUT/notices" "$B/maps"
CM=(-G Ninja -DCMAKE_BUILD_TYPE=Release "-DCMAKE_INSTALL_PREFIX=$PREFIX" "-DCMAKE_C_COMPILER=$CC" "-DCMAKE_CXX_COMPILER=$CXX"
    -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres "-DCMAKE_AR=$LLVM/bin/llvm-ar.exe" "-DCMAKE_RANLIB=$LLVM/bin/llvm-ranlib.exe"
    -DCMAKE_ASM_NASM_COMPILER=nasm)

phase tools
{
  $CC --version | head -1; $CXX --version | head -1; ld.lld --version; llvm-ar --version | head -2 | tail -1
  cmake --version | head -1; echo "ninja $(ninja --version)"; python -V; echo "meson $(python $W/t/meson-1.12.1/meson.py --version)"
  nasm -v; echo "pkgconf $(pkgconf --version)"; make --version | head -1; bash --version | head -1
} > "$OUT/info/tool-versions.txt" 2>&1

phase zlib
cd "$S/zlib-1.4"; mkdir -p obj
for c in adler32 compress crc32 deflate gzclose gzlib gzread gzwrite infback inffast inflate inftrees trees uncompr zutil; do
  log zlib $CC -O2 -c "$c.c" -o "obj/$c.o"
done
log zlib llvm-ar rcs "$P/lib/libz.a" obj/*.o
cp zlib.h zconf.h "$P/include/"
cat > "$P/lib/pkgconfig/zlib.pc" <<EOF
prefix=$PREFIX
libdir=\${prefix}/lib
includedir=\${prefix}/include
Name: zlib
Description: zlib compression library
Version: 1.4
Libs: -L\${libdir} -lz
Cflags: -I\${includedir}
EOF

phase x264
cd "$S/x264-0.164.3108+git31e19f9"
log x264 ./configure --prefix=$PREFIX --host=x86_64-w64-mingw32 --cross-prefix=x86_64-w64-mingw32- --enable-static --disable-cli \
  --bit-depth=all --chroma-format=all --disable-opencl --disable-lavf --disable-swscale --disable-ffms --disable-gpac --disable-lsmash --enable-strip
log x264 make -j$JOBS
log x264 make install
cp config.log "$OUT/info/x264-config.log"; cp x264_config.h "$OUT/info/"

phase x265
X=$W/src/x265_4.1/source
# x265's Version.cmake reads the bundled x265Version.txt only when CMake reports Git as found.
# No Git exists here, so name a no-op program; no repository command is ever run.
X265V=(-DGIT_EXECUTABLE=C:/b/msys64/usr/bin/true.exe)
mkdir -p "$B/x265/10" "$B/x265/8"
cd "$B/x265/10"
log x265 cmake "${CM[@]}" "$X" -DHIGH_BIT_DEPTH=ON -DEXPORT_C_API=OFF -DENABLE_SHARED=OFF -DENABLE_CLI=OFF -DENABLE_ASSEMBLY=ON "${X265V[@]}"
log x265 ninja -j$JOBS
cp libx265.a ../8/libx265_main10.a
cd "$B/x265/8"
log x265 cmake "${CM[@]}" "$X" -DEXTRA_LIB=x265_main10.a -DEXTRA_LINK_FLAGS=-L. -DLINKED_10BIT=ON -DENABLE_SHARED=OFF -DENABLE_CLI=OFF -DENABLE_ASSEMBLY=ON "${X265V[@]}"
log x265 ninja -j$JOBS
mv libx265.a libx265_main.a
printf 'CREATE libx265.a\nADDLIB libx265_main.a\nADDLIB libx265_main10.a\nSAVE\nEND\n' | llvm-ar -M
cp libx265.a "$P/lib/"; cp "$S/x265_4.1/source/x265.h" x265_config.h "$P/include/"; cp x265_config.h "$OUT/info/"
# The generated .pc lists toolchain-internal libraries; FFmpeg links with the C
# driver, so name the static C++ runtime and unwinder explicitly instead.
cat > "$P/lib/pkgconfig/x265.pc" <<EOF
prefix=$PREFIX
libdir=\${prefix}/lib
includedir=\${prefix}/include
Name: x265
Description: H.265/HEVC video encoder (8-bit with linked 10-bit)
Version: 4.1
Libs: -L\${libdir} -lx265
Libs.private: -lc++ -lunwind
Cflags: -I\${includedir}
EOF

phase svt-av1
mkdir -p "$B/svt"; cd "$B/svt"
log svt cmake "${CM[@]}" "$W/src/SVT-AV1-v2.3.0" -DBUILD_SHARED_LIBS=OFF -DBUILD_APPS=OFF -DBUILD_TESTING=OFF -DENABLE_NASM=ON
log svt ninja -j$JOBS
log svt ninja install

phase dav1d
cd "$S/dav1d-1.5.1"
log dav1d python "$W/t/meson-1.12.1/meson.py" setup "$W/dav1d-build" --prefix=$PREFIX --libdir=lib --buildtype=release \
  --default-library=static -Denable_tools=false -Denable_tests=false -Denable_examples=false
log dav1d ninja -C "$W/dav1d-build" -j$JOBS
log dav1d ninja -C "$W/dav1d-build" install

phase ffnvcodec
cd "$S/nv-codec-headers-13.0.19.0"
log ffnvcodec make PREFIX=$PREFIX install

phase target-pkgconfig
for m in zlib x264 x265 SvtAv1Enc dav1d ffnvcodec; do
  printf '%s %s | %s\n' "$m" "$(pkgconf --modversion $m)" "$(pkgconf --static --libs $m)"
done > "$OUT/info/pkgconfig.txt"
cp "$P"/lib/pkgconfig/*.pc "$OUT/info/"

phase ffmpeg-configure
cd "$S/ffmpeg-9.1"
log ffmpeg-configure ./configure --prefix=$PREFIX --enable-cross-compile --target-os=mingw32 --arch=x86_64 \
  --cc=$CC --cxx=$CXX --ar=llvm-ar --nm=llvm-nm --ranlib=llvm-ranlib --strip=llvm-strip --windres=x86_64-w64-mingw32-windres \
  --pkg-config=pkgconf --pkg-config-flags=--static --extra-ldflags=-static \
  --disable-autodetect --enable-w32threads --enable-gpl --enable-version3 --enable-static --disable-shared \
  --disable-doc --disable-debug --disable-ffplay --disable-network \
  --enable-zlib --enable-libx264 --enable-libx265 --enable-libsvtav1 --enable-libdav1d \
  --enable-ffnvcodec --enable-cuda --enable-cuvid --enable-nvdec --enable-nvenc
cp ffbuild/config.log "$OUT/info/ffmpeg-config.log"; cp ffbuild/config.mak config.h "$OUT/info/"

phase ffmpeg-build
log ffmpeg-build make -j$JOBS

phase ffmpeg-link
# Relink both programs once each with a linker map; the shipped .exe is the
# stripped copy of exactly this link.
LDX=$(sed -n 's/^LDEXEFLAGS=//p' ffbuild/config.mak)
for p in ffmpeg ffprobe; do
  rm -f "${p}_g.exe" "${p}.exe"
  log ffmpeg-link make "${p}_g.exe" "LDEXEFLAGS=$LDX -Wl,-Map=$W/maps/$p.map"
  log ffmpeg-link make "${p}.exe"
  test -s "$B/maps/$p.map"
done

phase pe-inspection
for p in ffmpeg ffprobe; do
  cp "$p.exe" "$OUT/bin/"; cp "$B/maps/$p.map" "$OUT/pe/"
  llvm-readobj --file-headers "$p.exe" > "$OUT/pe/$p-headers.txt"
  llvm-readobj --coff-imports "$p.exe" > "$OUT/pe/$p-imports.txt"
  ./$p.exe -hide_banner -buildconf > "$OUT/info/$p-buildconf.txt" 2>&1
  ./$p.exe -version > "$OUT/info/$p-version.txt" 2>&1
done
./ffmpeg.exe -hide_banner -L > "$OUT/info/ffmpeg-license.txt" 2>&1
( cd "$OUT/bin" && sha256sum ffmpeg.exe ffprobe.exe ) > "$OUT/pe/bin-SHA256SUMS"
( cd "$OUT/pe" && sha256sum ffmpeg.map ffprobe.map ) > "$OUT/pe/map-SHA256SUMS"

phase notices
for f in "$S"/ffmpeg-9.1/COPYING.* "$S/ffmpeg-9.1/LICENSE.md"; do cp "$f" "$OUT/notices/ffmpeg-$(basename "$f")"; done
cp "$S/x264-0.164.3108+git31e19f9/COPYING" "$OUT/notices/x264-COPYING"
cp "$S/x265_4.1/COPYING" "$OUT/notices/x265-COPYING"
cp "$S/SVT-AV1-v2.3.0/LICENSE.md" "$OUT/notices/SVT-AV1-LICENSE.md"; cp "$S/SVT-AV1-v2.3.0/LICENSE-BSD2.md" "$OUT/notices/SVT-AV1-LICENSE-BSD2.md"; cp "$S/SVT-AV1-v2.3.0/PATENTS.md" "$OUT/notices/SVT-AV1-PATENTS.md"
cp "$S/dav1d-1.5.1/COPYING" "$OUT/notices/dav1d-COPYING"
cp "$S/zlib-1.4/LICENSE" "$OUT/notices/zlib-LICENSE"
cp "$S/nv-codec-headers-13.0.19.0/README" "$OUT/notices/nv-codec-headers-README"
head -40 "$S/nv-codec-headers-13.0.19.0/include/ffnvcodec/nvEncodeAPI.h" > "$OUT/notices/nv-codec-headers-nvEncodeAPI-header.txt"
cp "$LLVM/LICENSE.TXT" "$OUT/notices/llvm-mingw-LICENSE.TXT"
find "$LLVM" -maxdepth 3 -iname 'COPYING*' -o -maxdepth 3 -iname 'LICENSE*' > "$OUT/notices/llvm-mingw-license-files.txt"
phase done
