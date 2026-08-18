#!/usr/bin/env node
/*
 * Fetches llama.cpp's `llama-server` prebuilt for the current platform (or all
 * platforms with `--all`) from the pinned GitHub release in
 * resources/llama-binaries.json, and drops the extracted contents in
 * resources/<platform>-<arch>/llama-server/ so forge.config.js can bundle
 * them as extraResource at package time.
 *
 * Runs as `prepackage` so `npm run make-*` gets the binaries automatically.
 * Idempotent: writes a `.tag` sentinel and skips re-download when the pinned
 * tag already matches on disk.
 *
 * Windows tar (Win10+) handles both .zip and .tar.gz; macOS/Linux use tar for
 * .tar.gz and unzip for .zip — both are on every dev/CI host we build on.
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')
const https = require('https')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const MANIFEST_PATH = path.join(ROOT, 'resources', 'llama-binaries.json')
const CACHE_DIR = path.join(ROOT, '.cache', 'llama-binaries')

const argv = process.argv.slice(2)
const argSet = new Set(argv)
const wantAll = argSet.has('--all')
const force = argSet.has('--force')

function normalizeArch(raw) {
  const arch = String(raw || '').toLowerCase()
  if (arch === 'x86' || arch === 'i386' || arch === 'i686') return 'ia32'
  if (arch === 'x86_64' || arch === 'amd64') return 'x64'
  if (arch === 'aarch64') return 'arm64'
  return arch
}

function normalizeTargetKey(raw) {
  const input = String(raw || '').trim().toLowerCase()
  if (!input.includes('-')) return input
  const [platform, arch] = input.split('-', 2)
  return `${platform}-${normalizeArch(arch)}`
}

function pickFallbackTarget(targetKey, platforms) {
  const [platform, arch] = targetKey.split('-', 2)
  if (platform !== 'win32') return null
  if (arch === 'arm64' && platforms['win32-x64']) return 'win32-x64'
  if (arch === 'ia32' && platforms['win32-x64']) return 'win32-x64'
  return null
}

// `--target <platform-arch>` OR TARGET_PLATFORM / TARGET_ARCH env vars override
// the current process. Needed for cross-arch builds (a macOS developer
// packaging for win32-arm64 shouldn't fetch the macOS binary).
function resolveTargetKey() {
  const flagIdx = argv.indexOf('--target')
  if (flagIdx !== -1 && argv[flagIdx + 1]) return normalizeTargetKey(argv[flagIdx + 1])
  if (process.env.TARGET_PLATFORM && process.env.TARGET_ARCH) {
    return `${process.env.TARGET_PLATFORM}-${normalizeArch(process.env.TARGET_ARCH)}`
  }
  return `${process.platform}-${normalizeArch(process.arch)}`
}

function log(...m) {
  console.log('[fetch-llama-binaries]', ...m)
}

async function main() {
  const manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, 'utf8'))
  const { tag, baseUrl, platforms } = manifest

  const targetKey = resolveTargetKey()
  const fallbackTarget = pickFallbackTarget(targetKey, platforms)
  const targets = wantAll
    ? Object.keys(platforms)
    : platforms[targetKey]
      ? [targetKey]
      : fallbackTarget
        ? [fallbackTarget]
      : []

  if (!wantAll && !platforms[targetKey] && fallbackTarget) {
    log(`no pinned binary for ${targetKey}; falling back to ${fallbackTarget}`)
  }

  if (targets.length === 0) {
    log(
      `no llama-server binary pinned for ${targetKey} — skipping.`,
      `Supported keys: ${Object.keys(platforms).join(', ')}. Pass --all to fetch every platform.`,
    )
    return
  }

  await fsp.mkdir(CACHE_DIR, { recursive: true })

  for (const key of targets) {
    const p = platforms[key]
    const destDir = path.join(ROOT, 'resources', key, 'llama-server')
    const stampPath = path.join(destDir, '.tag')

    if (!force) {
      try {
        const stamp = await fsp.readFile(stampPath, 'utf8')
        if (stamp.trim() === tag) {
          log(`${key}: already at ${tag}, skipping`)
          continue
        }
      } catch (_) {
        // no stamp — fresh install
      }
    }

    const url = `${baseUrl}/${tag}/${p.asset}`
    const cachedArchive = path.join(CACHE_DIR, `${tag}-${p.asset}`)

    if (!fs.existsSync(cachedArchive) || force) {
      log(`${key}: downloading ${p.asset} (${(p.size / 1024 / 1024).toFixed(1)} MB)`)
      await download(url, cachedArchive, p.size)
    } else {
      log(`${key}: using cached ${path.basename(cachedArchive)}`)
    }

    await fsp.rm(destDir, { recursive: true, force: true })
    await fsp.mkdir(destDir, { recursive: true })
    log(`${key}: extracting into resources/${key}/llama-server/`)
    extract(cachedArchive, destDir)
    await flattenSingleTopLevelDir(destDir)
    await pruneUnwanted(destDir)
    await fsp.writeFile(stampPath, tag + '\n')
    log(`${key}: done`)
  }
}

function download(url, dest, expectedSize) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.part'
    const file = fs.createWriteStream(tmp)
    let received = 0
    let lastPrinted = 0

    const go = (u) => {
      https
        .get(u, { headers: { 'User-Agent': 'oobee-desktop-fetch/1.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            return go(res.headers.location)
          }
          if (res.statusCode !== 200) {
            file.close()
            fs.unlink(tmp, () => {})
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          }
          res.on('data', (chunk) => {
            received += chunk.length
            if (received - lastPrinted > 2 * 1024 * 1024 || received === expectedSize) {
              lastPrinted = received
              const pct = expectedSize ? ((received / expectedSize) * 100).toFixed(0) : '?'
              process.stdout.write(`\r  ${(received / 1024 / 1024).toFixed(1)} MB (${pct}%)   `)
            }
          })
          res.pipe(file)
          file.on('finish', () => {
            process.stdout.write('\n')
            file.close(() => {
              fs.rename(tmp, dest, (err) => (err ? reject(err) : resolve()))
            })
          })
        })
        .on('error', (err) => {
          file.close()
          fs.unlink(tmp, () => {})
          reject(err)
        })
    }
    go(url)
  })
}

// llama.cpp release archives wrap everything in a `llama-b<N>/` folder. Flatten
// it so the runtime resolver in llamaServer.js can find the binary at a fixed
// relative path regardless of the pinned tag.
async function flattenSingleTopLevelDir(destDir) {
  const entries = await fsp.readdir(destDir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())
  const files = entries.filter((e) => e.isFile())
  if (dirs.length !== 1 || files.length > 0) return // already flat or mixed layout
  const wrapper = path.join(destDir, dirs[0].name)
  const inner = await fsp.readdir(wrapper)
  for (const name of inner) {
    await fsp.rename(path.join(wrapper, name), path.join(destDir, name))
  }
  await fsp.rmdir(wrapper)
}

// The release archive ships every llama.cpp CLI (llama-cli, llama-bench,
// llama-tts, etc). We only need the server + its dynamic dependencies; toss
// the rest to keep the packaged app ~20 MB smaller per platform.
async function pruneUnwanted(destDir) {
  const KEEP = /^(llama-server(\.exe)?|.*\.(dylib|dll|so(\.[0-9.]+)?)|LICENSE.*|.*\.metallib)$/
  for (const entry of await fsp.readdir(destDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue // .tag sentinel
    if (KEEP.test(entry.name)) continue
    const full = path.join(destDir, entry.name)
    await fsp.rm(full, { recursive: true, force: true })
  }
}

function extract(archive, destDir) {
  const isTarGz = archive.endsWith('.tar.gz') || archive.endsWith('.tgz')
  const isZip = archive.endsWith('.zip')
  if (!isTarGz && !isZip) throw new Error(`Unsupported archive: ${archive}`)

  // Windows tar (bsdtar, ships with Win10 1803+) handles both .zip and .tar.gz.
  // On Unix we prefer `tar` for .tar.gz and `unzip` for .zip — both are on
  // every macOS/Linux host and don't add a dev dependency.
  const cmd =
    isTarGz
      ? `tar -xzf "${archive}" -C "${destDir}"`
      : process.platform === 'win32'
        ? `tar -xf "${archive}" -C "${destDir}"`
        : `unzip -q -o "${archive}" -d "${destDir}"`
  execSync(cmd, { stdio: 'inherit' })
}

main().catch((err) => {
  console.error('[fetch-llama-binaries] fatal:', err.message)
  process.exit(1)
})
