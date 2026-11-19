#!/usr/bin/env bash
# Builds the WebP decoder for Dragon Drop: libwebp (decoder only) compiled to WebAssembly, written out as packages/tools/src/webpWasm.ts.
#
#   tools/webp-wasm/build.sh            (needs: curl, tar, sha256sum, python3 and pip; it fetches libwebp and the zig compiler itself)
#
# The result is checked in, so building the app never needs any of this. Run it again only to move to a newer libwebp: change VERSION and SHA256 below, run it,
# and the tests (packages/tools/test/webp.test.ts) say whether the new build still decodes the same pictures. The build is reproducible: the same inputs
# give the same bytes (checked by building twice).
#
# Where SHA256 comes from: the tarball as downloaded over HTTPS from the official download host (downloads.webmproject.org). The release also has a detached
# signature (libwebp-$VERSION.tar.gz.asc, made with key 6B0E6B70976DE303EDF2F601F9C3D6BDB8232B5D); the key could not be fetched where 1.6.0 was packaged, so that
# signature was NOT checked. Whoever next updates this should check it (gpg --verify) against the key listed on the libwebp download page, and say so here.
set -euo pipefail

VERSION=1.6.0
SHA256=e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564
ZIG=0.17.1    # a C compiler that carries the WebAssembly C library with it (installed from PyPI as "ziglang")

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/libwebp.tar.gz" "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-$VERSION.tar.gz"
echo "$SHA256  $work/libwebp.tar.gz" | sha256sum -c -
tar xzf "$work/libwebp.tar.gz" -C "$work"
src="$work/libwebp-$VERSION"

pip install --quiet --target "$work/zig" "ziglang==$ZIG"
zig() { PYTHONPATH="$work/zig" python3 -m ziglang "$@"; }

# the files libwebp itself builds into its decoder-only library (src/*/Makefile.am: libwebpdecode, libwebpdspdecode, libwebputilsdecode),
# without the machine-specific speed-ups (SSE, NEON...): plain C
files=(
  "$src"/src/dec/{alpha_dec,buffer_dec,frame_dec,idec_dec,io_dec,quant_dec,tree_dec,vp8_dec,vp8l_dec,webp_dec}.c
  "$src"/src/dsp/{alpha_processing,cpu,dec,dec_clip_tables,filters,lossless,rescaler,upsampling,yuv}.c
  "$src"/src/utils/{bit_reader_utils,color_cache_utils,filters_utils,huffman_utils,palette,quant_levels_dec_utils,rescaler_utils,random_utils,thread_utils,utils}.c
  "$here/dd_webp.c"
)

zig cc -target wasm32-wasi -mexec-model=reactor -O2 -DNDEBUG -fno-stack-protector \
  -I "$src" -I "$src/src" \
  -Wl,--gc-sections -Wl,--strip-all -Wl,-z,stack-size=524288 -Wl,--max-memory=2147483648 \
  "${files[@]}" -o "$work/webp.wasm"

ls -l "$work/webp.wasm"
node "$here/embed.mjs" "$work/webp.wasm" "$repo/packages/tools/src/webpWasm.ts" "$VERSION"
cp "$src/COPYING" "$here/LICENSE-libwebp.txt"

# the licences of what the compiler links into the module besides libwebp: the WebAssembly C library (wasi-libc: its own MIT licence, dlmalloc's CC0 note,
# musl's and cloudlibc's licences) and the compiler's runtime library (Zig's MIT licence)
libc="$work/zig/ziglang/lib/libc/wasi"
{
  echo "The module also contains parts of the WebAssembly C library (wasi-libc) and of the compiler's runtime library, under these licences."
  echo; echo "=== wasi-libc: LICENSE ==="; cat "$libc/LICENSE"
  echo; echo "=== wasi-libc: LICENSE-MIT (the licence it is used under here) ==="; cat "$libc/LICENSE-MIT"
  echo; echo "=== musl: COPYRIGHT ==="; cat "$libc/libc-top-half/musl/COPYRIGHT"
  echo; echo "=== cloudlibc: LICENSE ==="; cat "$libc/libc-bottom-half/cloudlibc/LICENSE"
  echo; echo "=== Zig (compiler runtime library): LICENSE ==="; cat "$work/zig/ziglang/LICENSE"
} > "$here/LICENSE-wasm-runtime.txt"
