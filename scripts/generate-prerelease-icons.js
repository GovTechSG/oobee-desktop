#!/usr/bin/env node
/*
 * When PRE_RELEASE is set, render grey-background variants of the app icon
 * (.icns for macOS, .ico for Windows, .png as fallback) into
 * .cache/prerelease-icons/ so forge.config.js can point at them at package
 * time. No-op when PRE_RELEASE is unset — the make-* scripts call this
 * unconditionally.
 *
 * We swap #9021a6 (purple) for #808080 (mid grey) in the source SVG and
 * rasterize with sharp. .icns is assembled via macOS `iconutil` (macOS
 * builds run on macOS so this is safe). .ico is a hand-rolled container
 * around a single 256x256 PNG so this works cross-platform.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const sharp = require('sharp');

const PURPLE_HEX = '#9021a6';
const GREY_HEX = '#808080';

const ROOT = path.join(__dirname, '..');
const SRC_SVG = path.join(ROOT, 'public', 'oobee-logo.svg');
const OUT_DIR = path.join(ROOT, '.cache', 'prerelease-icons');
const OUT_PREFIX = path.join(OUT_DIR, 'oobee-logo');

function isPreRelease() {
  const v = String(process.env.PRE_RELEASE || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function normalizeArch(raw) {
  const arch = String(raw || '').toLowerCase();
  if (arch === 'x86' || arch === 'i386' || arch === 'i686') return 'ia32';
  if (arch === 'x86_64' || arch === 'amd64') return 'x64';
  if (arch === 'aarch64') return 'arm64';
  return arch;
}

async function generateIcns(svgBuf) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oobee-iconset-'));
  const iconsetDir = path.join(workDir, 'oobee.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });
  const spec = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of spec) {
    await sharp(svgBuf).resize(size, size).png().toFile(path.join(iconsetDir, name));
  }
  execSync(`iconutil -c icns "${iconsetDir}" -o "${OUT_PREFIX}.icns"`, { stdio: 'inherit' });
  fs.rmSync(workDir, { recursive: true, force: true });
}

async function generateIco(svgBuf) {
  const png = await sharp(svgBuf).resize(256, 256).png().toBuffer();
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  fs.writeFileSync(`${OUT_PREFIX}.ico`, Buffer.concat([header, entry, png]));
}

async function generatePng(svgBuf) {
  await sharp(svgBuf).resize(512, 512).png().toFile(`${OUT_PREFIX}.png`);
}

async function main() {
  if (!isPreRelease()) {
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const svg = fs.readFileSync(SRC_SVG, 'utf8');
  const greySvg = svg.replace(new RegExp(PURPLE_HEX, 'gi'), GREY_HEX);
  const svgBuf = Buffer.from(greySvg);

  const targetPlatform = process.env.TARGET_PLATFORM || os.platform();
  const hostPlatform = os.platform();

  await generatePng(svgBuf);

  if (targetPlatform === 'darwin') {
    if (hostPlatform !== 'darwin') {
      throw new Error('Cannot build macOS .icns off macOS — iconutil is required.');
    }
    await generateIcns(svgBuf);
  }

  if (targetPlatform === 'win32') {
    await generateIco(svgBuf);
  }

  console.log(`[prerelease-icons] wrote grey icons for ${targetPlatform} to ${OUT_DIR}`);
  const _ = normalizeArch(process.env.TARGET_ARCH); // reserved for future per-arch icon variants
}

main().catch((err) => {
  console.error('[prerelease-icons] failed:', err);
  process.exit(1);
});
