#!/usr/bin/env bash
#
# Cross-compile llama.cpp with Metal enabled for darwin-x64.
#
# ggml-org's official darwin-x64 release ships CPU-only libs (no GPU backend),
# so Intel Mac users get no acceleration from the pinned binary. This script
# fills that gap by cross-compiling from an arm64 macos-latest GHA runner with
# CMAKE_OSX_ARCHITECTURES=x86_64.
#
# Any *.patch files under scripts/llama-patches/ (sorted lexically) are applied
# to the fresh clone before build. This is how we vendor small AMD-GPU
# Metal-driver fixes that upstream hasn't merged yet.
#
# Inputs (env or positional):
#   $1 or $LLAMA_TAG       — llama.cpp tag/branch to build (required)
#   $2 or $OUTPUT_DIR      — directory to write llama-server + dylibs into
#                             (default: resources/darwin-x64/llama-server)
#   $3 or $PATCHES_DIR     — directory of .patch files to `git apply`
#                             (default: scripts/llama-patches, relative to
#                             this script's parent)
#
# The output directory ends up structured to match ggml-org's arm64 tarball
# (Mach-O binary + SOVERSION dylib symlink triples + @loader_path rpath),
# so @electron/universal's file counts across arches align during packaging.

set -euo pipefail

# --- resolve args ---
TAG="${1:-${LLAMA_TAG:-}}"
if [ -z "$TAG" ]; then
  echo "error: llama.cpp tag required (arg 1 or LLAMA_TAG env)" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUTPUT_DIR="${2:-${OUTPUT_DIR:-$REPO_ROOT/resources/darwin-x64/llama-server}}"
PATCHES_DIR="${3:-${PATCHES_DIR:-$SCRIPT_DIR/llama-patches}}"

BUILD_ROOT="${BUILD_ROOT:-/tmp/llama.cpp}"

echo "==> llama.cpp tag:  $TAG"
echo "==> output dir:     $OUTPUT_DIR"
echo "==> patches dir:    $PATCHES_DIR"
echo "==> build root:     $BUILD_ROOT"

# --- clone ---
rm -rf "$BUILD_ROOT"
git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp "$BUILD_ROOT"

# --- apply vendored patches (if any) ---
# Use `git apply` (not `patch -p1`) so we get a clean error message on
# conflicts, and so `--check` can run first as a dry run. Skips silently if
# the patches directory is missing or empty — no patches is a valid state.
if [ -d "$PATCHES_DIR" ]; then
  # shellcheck disable=SC2044
  PATCH_FILES=$(find "$PATCHES_DIR" -maxdepth 1 -type f -name '*.patch' | sort)
  if [ -n "$PATCH_FILES" ]; then
    echo "==> applying patches from $PATCHES_DIR"
    (
      cd "$BUILD_ROOT"
      # Preserve iteration semantics even if PATCH_FILES contains spaces
      # (it won't — our filenames are ASCII — but be robust).
      while IFS= read -r p; do
        [ -z "$p" ] && continue
        echo "    - $(basename "$p")"
        git apply --check "$p"
        git apply "$p"
      done <<< "$PATCH_FILES"
    )
  else
    echo "==> no *.patch files in $PATCHES_DIR — skipping patch step"
  fi
else
  echo "==> patches dir does not exist — skipping patch step"
fi

# --- configure ---
# Cross-compile from arm64 runner to x86_64. Metal shaders are GPU-
# architecture, not CPU-architecture, so EMBED_LIBRARY works either way.
# Deployment target 11.0 matches ggml-org's official builds.
#
# LLAMA_SERVER_SSL=OFF + CMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE:
# cpp-httplib auto-enables its TLS code path whenever cmake finds OpenSSL.
# GHA runners have Homebrew's arm64 OpenSSL on the search path, which then
# fails to link into an x86_64 binary. Forcing OpenSSL to be "not found"
# keeps cpp-httplib in plaintext-only mode (fine — the server binds to
# 127.0.0.1 anyway).
#
# CMAKE_BUILD_WITH_INSTALL_RPATH + CMAKE_INSTALL_RPATH=@loader_path:
# cmake defaults to baking the build tree (/tmp/llama.cpp/build/bin) as an
# LC_RPATH entry so binaries can find their dylibs during development. On
# end-user Macs that /tmp/ dir doesn't exist and llama-server aborts on
# load. Match ggml-org's official arm64 binary, which ships with a single
# @loader_path rpath — that resolves via the dylib's own directory, which
# after packaging is <app>/Contents/Resources/llama-server/.
cmake -S "$BUILD_ROOT" -B "$BUILD_ROOT/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=x86_64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
  -DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew \
  -DCMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE \
  -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
  -DCMAKE_INSTALL_RPATH='@loader_path' \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_NATIVE=OFF \
  -DLLAMA_CURL=OFF \
  -DLLAMA_SERVER_SSL=OFF \
  -DBUILD_SHARED_LIBS=ON

# --- build ---
# macos-latest arm64 runners are 3-core; use hw.ncpu to size -j exactly to
# the host so we don't oversubscribe (cpp-httplib alone eats ~4 GB while
# compiling and the runner has 7 GB total).
NPROC=$(sysctl -n hw.ncpu)
echo "==> building with -j $NPROC"
cmake --build "$BUILD_ROOT/build" -j "$NPROC" --target llama-server

# --- verify + stage output ---
file "$BUILD_ROOT/build/bin/llama-server"
file "$BUILD_ROOT/build/bin/llama-server" | grep -q x86_64

mkdir -p "$OUTPUT_DIR"
cp "$BUILD_ROOT/build/bin/llama-server" "$OUTPUT_DIR/"
# -P preserves symlinks. cmake's SOVERSION emits three names per library
# (libFoo.dylib -> libFoo.0.dylib -> libFoo.0.20.2.dylib); ggml-org's tarball
# ships them as 1 real file + 2 symlinks, and @electron/universal counts
# Mach-O files across the two arch slices — if x64 has 3 real files while
# arm64 has 1 + 2 symlinks, the counts diverge and the universal merge
# aborts.
cp -P "$BUILD_ROOT/build/bin/"*.dylib "$OUTPUT_DIR/"

# Belt-and-suspenders rpath cleanup: llama.cpp's per-target CMakeLists
# occasionally set INSTALL_RPATH themselves, overriding the top-level
# CMAKE_INSTALL_RPATH we passed above. Walk every real Mach-O file in the
# shipped tree, strip any stray build-tree rpath, ensure @loader_path is
# present, and ad-hoc re-sign (install_name_tool invalidates whatever
# signature cmake baked in; Electron's osxSign will replace this with the
# Developer ID Application signature during packaging).
for f in "$OUTPUT_DIR/llama-server" "$OUTPUT_DIR/"*.dylib; do
  [ -L "$f" ] && continue  # skip SOVERSION symlinks
  install_name_tool -delete_rpath "$BUILD_ROOT/build/bin" "$f" 2>/dev/null || true
  install_name_tool -add_rpath @loader_path "$f" 2>/dev/null || true
  codesign --sign - --force "$f" 2>/dev/null || true
done
echo "==> verify llama-server rpath entries:"
otool -l "$OUTPUT_DIR/llama-server" | grep -A 2 LC_RPATH || true

# Stamp with the manifest tag so fetch-llama-binaries.js sees a match on
# subsequent prepackage runs and skips the ggml-org download.
echo "$TAG" > "$OUTPUT_DIR/.tag"

echo "==> output directory contents:"
ls -la "$OUTPUT_DIR/"
