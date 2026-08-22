#!/usr/bin/env bash
#
# Build llama.cpp with Vulkan enabled for darwin-x64.
#
# Why Vulkan instead of Metal on Intel Mac: llama.cpp's Metal backend produces
# garbage output on AMD discrete GPUs on macOS (issue ggml-org/llama.cpp#19563)
# — both the MTLDispatchTypeConcurrent KV-cache-corruption bug and the
# simd_max(half) mis-compute on AMD RDNA are unfixed upstream. Comment #5 on
# that issue demonstrates the Vulkan backend via MoltenVK produces correct
# output on the same hardware. ggml-org's official darwin-x64 tarball ships
# CPU-only libs, so we build our own Vulkan-enabled server here.
#
# Runs natively on an Intel macOS runner (no cross-compile). MoltenVK
# (Apache-2.0) and Vulkan-Loader (Apache-2.0) are pulled from Homebrew and
# bundled into the output directory next to llama-server.
#
# Inputs (env or positional):
#   $1 or $LLAMA_TAG    — llama.cpp tag/branch to build (required)
#   $2 or $OUTPUT_DIR   — directory to write llama-server + dylibs into
#                          (default: resources/darwin-x64/llama-server)

set -euo pipefail

TAG="${1:-${LLAMA_TAG:-}}"
if [ -z "$TAG" ]; then
  echo "error: llama.cpp tag required (arg 1 or LLAMA_TAG env)" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUTPUT_DIR="${2:-${OUTPUT_DIR:-$REPO_ROOT/resources/darwin-x64/llama-server}}"
BUILD_ROOT="${BUILD_ROOT:-/tmp/llama.cpp}"

echo "==> llama.cpp tag:  $TAG"
echo "==> output dir:     $OUTPUT_DIR"
echo "==> build root:     $BUILD_ROOT"
echo "==> arch:           $(uname -m)"

# --- install Vulkan toolchain from Homebrew ---
# All four formulae are Apache-2.0. molten-vk provides the MoltenVK ICD, and
# vulkan-loader provides libvulkan.<ver>.dylib that llama-server links
# against. glslang + shaderc are build-time tooling used by llama.cpp's
# vulkan-shaders-gen to compile the GGML shader collection during the build.
brew update
brew install molten-vk vulkan-loader vulkan-headers glslang shaderc

MOLTENVK_PREFIX="$(brew --prefix molten-vk)"
VULKAN_LOADER_PREFIX="$(brew --prefix vulkan-loader)"
echo "==> molten-vk:      $MOLTENVK_PREFIX"
echo "==> vulkan-loader:  $VULKAN_LOADER_PREFIX"

# --- clone ---
rm -rf "$BUILD_ROOT"
git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp "$BUILD_ROOT"

# --- configure ---
# GGML_NATIVE=OFF is important: on Homebrew macos-13 runners the reported CPU
# features get baked into the Vulkan backend's SPIR-V dispatch heuristics; a
# non-native flag set keeps the binary portable across Intel Mac SKUs (some
# users are on 2015-vintage Xeons without AVX2).
#
# LLAMA_SERVER_SSL=OFF: cpp-httplib probes for OpenSSL and links it if found;
# we bind to 127.0.0.1 only so TLS is unnecessary — dropping OpenSSL keeps
# the dep footprint minimal.
#
# CMAKE_INSTALL_RPATH=@loader_path: ships all dylibs (ggml + vulkan-loader)
# alongside llama-server so the runtime finds them via the binary's own
# directory, matching ggml-org's arm64 tarball convention.
#
# BUILD_SHARED_LIBS=ON: ggml-org's arm64 tarball ships each libggml-* as its
# own SOVERSION dylib triple (real file + 2 symlinks). @electron/universal
# counts Mach-O files across the two arch slices during universal binary
# fusion — if one side is static and the other shared, the counts diverge
# and the merge aborts.
cmake -S "$BUILD_ROOT" -B "$BUILD_ROOT/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=x86_64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DCMAKE_PREFIX_PATH="$VULKAN_LOADER_PREFIX;$MOLTENVK_PREFIX;$(brew --prefix vulkan-headers);$(brew --prefix glslang);$(brew --prefix shaderc)" \
  -DCMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE \
  -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
  -DCMAKE_INSTALL_RPATH='@loader_path' \
  -DGGML_VULKAN=ON \
  -DGGML_METAL=OFF \
  -DGGML_NATIVE=OFF \
  -DLLAMA_CURL=OFF \
  -DLLAMA_SERVER_SSL=OFF \
  -DBUILD_SHARED_LIBS=ON

# --- build ---
NPROC=$(sysctl -n hw.ncpu)
echo "==> building with -j $NPROC"
cmake --build "$BUILD_ROOT/build" -j "$NPROC" --target llama-server

# --- verify Mach-O arch ---
file "$BUILD_ROOT/build/bin/llama-server"
file "$BUILD_ROOT/build/bin/llama-server" | grep -q x86_64

# --- stage output ---
mkdir -p "$OUTPUT_DIR"
cp "$BUILD_ROOT/build/bin/llama-server" "$OUTPUT_DIR/"
# -P preserves the SOVERSION symlink triples (see BUILD_SHARED_LIBS comment
# above).
cp -P "$BUILD_ROOT/build/bin/"*.dylib "$OUTPUT_DIR/"

# --- bundle MoltenVK (ICD driver — discovered at runtime via ICD JSON) ---
# libMoltenVK.dylib gets loaded by libvulkan.dylib after it reads the ICD
# JSON that VK_ICD_FILENAMES points at. No install_name rewrite is needed
# because the ICD JSON's library_path is what drives the dlopen call, not
# the linker.
cp "$MOLTENVK_PREFIX/lib/libMoltenVK.dylib" "$OUTPUT_DIR/"

# --- bundle Vulkan-Loader ---
# The loader's SONAME is libvulkan.1.dylib; llama-server links against that.
# Homebrew ships the triple (libvulkan.dylib -> libvulkan.1.dylib ->
# libvulkan.1.<full-ver>.dylib) — copy all three so `dlopen` can resolve
# through the symlink chain the same way the linker recorded the reference.
cp -P "$VULKAN_LOADER_PREFIX/lib/"libvulkan.*.dylib "$OUTPUT_DIR/"
cp -P "$VULKAN_LOADER_PREFIX/lib/libvulkan.dylib" "$OUTPUT_DIR/" 2>/dev/null || true

# --- ICD JSON: point at our bundled MoltenVK by relative path ---
# Vulkan-Loader resolves ICD `library_path` against the JSON's own directory
# when the path is relative, so `./libMoltenVK.dylib` works regardless of
# where the app bundle ends up installed.
cat > "$OUTPUT_DIR/MoltenVK_icd.json" <<'EOF'
{
    "file_format_version" : "1.0.0",
    "ICD": {
        "library_path" : "./libMoltenVK.dylib",
        "api_version" : "1.2.0",
        "is_portability_driver" : true
    }
}
EOF

# --- rpath + install_name cleanup ---
# Homebrew bakes absolute paths (e.g. /usr/local/opt/vulkan-loader/lib/...)
# into libvulkan's own install_name. Once shipped inside a user's .app, that
# path won't exist and dyld aborts. Rewrite every dependency reference in
# llama-server and libvulkan.* to @rpath/<basename>, and ensure the binary
# has @loader_path on its LC_RPATH list.
for f in "$OUTPUT_DIR/llama-server" "$OUTPUT_DIR/"libvulkan*.dylib "$OUTPUT_DIR/"libggml*.dylib "$OUTPUT_DIR/"libllama*.dylib; do
  [ -e "$f" ] || continue
  [ -L "$f" ] && continue  # skip SOVERSION symlinks

  # Set the dylib's own install_name to @rpath/basename so the dyld cache
  # resolution matches. Fine on the binary too — install_name_tool -id is a
  # no-op on executables but doesn't fail.
  install_name_tool -id "@rpath/$(basename "$f")" "$f" 2>/dev/null || true

  # Rewrite each dependency line whose path contains a Homebrew prefix or
  # the build tree. otool -L output: `\tPATH (compat X, current Y)` — take
  # column 1 after trim.
  otool -L "$f" | awk 'NR>1 {print $1}' | while read -r dep; do
    case "$dep" in
      "$VULKAN_LOADER_PREFIX/"*|"$MOLTENVK_PREFIX/"*|"$BUILD_ROOT/"*|/usr/local/*|/opt/homebrew/*)
        install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$f" 2>/dev/null || true
        ;;
    esac
  done

  install_name_tool -delete_rpath "$BUILD_ROOT/build/bin" "$f" 2>/dev/null || true
  install_name_tool -add_rpath @loader_path "$f" 2>/dev/null || true

  # install_name_tool invalidates the ad-hoc signature cmake baked in;
  # Electron's osxSign will re-sign with Developer ID during packaging, but
  # the un-signed intermediate breaks Gatekeeper on developer machines that
  # test the tarball directly.
  codesign --sign - --force "$f" 2>/dev/null || true
done

echo "==> verify llama-server rpath entries:"
otool -l "$OUTPUT_DIR/llama-server" | grep -A 2 LC_RPATH || true
echo "==> verify llama-server library deps:"
otool -L "$OUTPUT_DIR/llama-server"

# Stamp with the manifest tag so fetch-llama-binaries.js skips the ggml-org
# download when this build is already in place.
echo "$TAG" > "$OUTPUT_DIR/.tag"

echo "==> output directory contents:"
ls -la "$OUTPUT_DIR/"
