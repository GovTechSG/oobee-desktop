#!/usr/bin/env bash
# Download the oobee backend zip for macOS packaging and verify its SHA-256
# against the sidecar published alongside the release. The backend is copied
# into the signed .app bundle by electron-forge, so we must not embed bytes
# whose integrity we haven't verified.
#
# Usage: BE_TAG=v0.11.16 scripts/fetch-backend-mac.sh [output_path]
# Defaults to /tmp/oobee-portable-mac.zip when no path is given, matching the
# path the make-mac / make-mac-arm64-only npm scripts pass to electron-forge
# via forge.config.js `extraResource`.

set -euo pipefail

: "${BE_TAG:?BE_TAG must be set (e.g. v0.11.16)}"
OUT_PATH="${1:-/tmp/oobee-portable-mac.zip}"

# Reject anything that isn't a plain release tag — this value is interpolated
# straight into the URL below, and the same value later flows through
# electron-forge into the app bundle.
if [[ ! "$BE_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || [[ ${#BE_TAG} -gt 64 ]]; then
  echo "Rejected BE_TAG: must match ^[A-Za-z0-9._-]+$ and be <=64 chars" >&2
  exit 1
fi

URL="https://github.com/GovTechSG/oobee/releases/download/${BE_TAG}/oobee-portable-mac.zip"
SIDECAR_URL="${URL}.sha256"
SIDECAR_PATH="${OUT_PATH}.sha256"

curl -fL --retry 3 --retry-connrefused -o "$OUT_PATH" "$URL"

if ! curl -fL --retry 3 --retry-connrefused -o "$SIDECAR_PATH" "$SIDECAR_URL"; then
  echo "Missing SHA-256 sidecar at ${SIDECAR_URL} — refusing to package unverified backend." >&2
  rm -f "$OUT_PATH"
  exit 1
fi

EXPECTED="$(tr -d '[:space:]' < "$SIDECAR_PATH" | tr 'A-F' 'a-f')"
if [[ ! "$EXPECTED" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Invalid SHA-256 digest from ${SIDECAR_URL}: $EXPECTED" >&2
  rm -f "$OUT_PATH" "$SIDECAR_PATH"
  exit 1
fi

ACTUAL="$(shasum -a 256 "$OUT_PATH" | awk '{ print $1 }' | tr 'A-F' 'a-f')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "SHA-256 mismatch for ${OUT_PATH}: expected $EXPECTED, got $ACTUAL" >&2
  rm -f "$OUT_PATH" "$SIDECAR_PATH"
  exit 1
fi

rm -f "$SIDECAR_PATH"
echo "Verified ${OUT_PATH} (sha256=${ACTUAL})"
