#!/usr/bin/env node
/*
 * Ensures `public/electron/frameworks-index/` exists before packaging.
 *
 * PRIMARY PATH (fast, ~10 MiB download):
 *   Downloads `docs-index.zip` from the oobee-ai-rag-index GitHub release
 *   tagged DOCS_INDEX_TAG (default: `latest-precompute`), extracts it to
 *   `.cache/frameworks-precomputed/`, then calls build-frameworks-index.js
 *   with FRAMEWORKS_PRECOMPUTED_DIR set -- no clone, no embedding pass.
 *
 * FALLBACK PATH (slow, requires network + ~1-2 GB disk):
 *   Clones oobee-ai-rag-index at EXPECTED_TAG, runs ensure-embedding-model.js,
 *   then calls build-frameworks-index.js in clone+embed mode.
 *   Disabled by passing `--no-clone-fallback`.
 *
 * Idempotent: skips rebuild if `public/electron/frameworks-index/` already
 * exists (non-empty). Pass `--force` to rebuild anyway.
 */

const fs = require('fs')
const https = require('https')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'electron', 'frameworks-index')
const PRECOMPUTED_DIR = path.join(ROOT, '.cache', 'frameworks-precomputed')
const ZIP_PATH = path.join(ROOT, '.cache', 'docs-index.zip')

// Fallback clone+embed constants (kept for --no-clone-fallback opt-out)
const SRC_DIR = path.join(ROOT, '.cache', 'frameworks-src')
const REPO_URL = 'https://github.com/GovTechSG/oobee-ai-rag-index.git'
const EXPECTED_TAG = 'synced/2026-08-25'

// Release tag for docs-index.zip. Override via DOCS_INDEX_TAG env var to pin
// without editing this file (image.yml passes it as DOCS_INDEX_TAG).
const DOCS_INDEX_TAG = process.env.DOCS_INDEX_TAG || 'latest-precompute'
const DOCS_INDEX_URL =
  process.env.DOCS_INDEX_URL ||
  `https://github.com/GovTechSG/oobee-ai-rag-index/releases/download/${DOCS_INDEX_TAG}/docs-index.zip`

const args = process.argv.slice(2)
const force = args.includes('--force')
const noCloneFallback = args.includes('--no-clone-fallback')

function log(...m) {
  console.log('[ensure-frameworks-index]', ...m)
}
function warn(...m) {
  console.warn('[ensure-frameworks-index]', ...m)
}

function isNonEmptyDir(dir) {
  try {
    return fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

// --- Download helpers --------------------------------------------------------

function downloadFile(url, destPath, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 5
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects: ' + url))
    log('downloading ' + url + ' ...')
    const file = fs.createWriteStream(destPath)
    https
      .get(url, { headers: { 'User-Agent': 'oobee-desktop/build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close()
          try { fs.unlinkSync(destPath) } catch { /* ignore */ }
          return resolve(downloadFile(res.headers.location, destPath, redirectsLeft - 1))
        }
        if (res.statusCode !== 200) {
          file.close()
          try { fs.unlinkSync(destPath) } catch { /* ignore */ }
          return reject(new Error('HTTP ' + res.statusCode + ' from ' + url))
        }
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
        file.on('error', (err) => {
          try { fs.unlinkSync(destPath) } catch { /* ignore */ }
          reject(err)
        })
      })
      .on('error', (err) => {
        try { fs.unlinkSync(destPath) } catch { /* ignore */ }
        reject(err)
      })
  })
}

function unzipToDir(zipPath, destDir) {
  // adm-zip@0.6.0's extractAllTo() recurses over every entry and blows the
  // call stack on large zips (~5-10 MB with 1,200+ chunks).  Iterate entries
  // manually instead — same result, O(1) stack depth.
  const AdmZip = require('adm-zip')
  const zip = new AdmZip(zipPath)
  fs.mkdirSync(destDir, { recursive: true })
  let count = 0
  for (const entry of zip.getEntries()) {
    const entryPath = path.join(destDir, entry.entryName)
    if (entry.isDirectory) {
      fs.mkdirSync(entryPath, { recursive: true })
    } else {
      fs.mkdirSync(path.dirname(entryPath), { recursive: true })
      fs.writeFileSync(entryPath, entry.getData())
      count++
    }
  }
  log('extracted ' + count + ' files from ' + zipPath + ' -> ' + destDir)
}

// --- Precomputed primary path ------------------------------------------------

async function buildFromPrecomputed() {
  fs.mkdirSync(path.dirname(ZIP_PATH), { recursive: true })

  // Re-use a previously downloaded zip if present (e.g. CI cache restored it).
  if (!force && fs.existsSync(ZIP_PATH)) {
    log('reusing cached zip at ' + ZIP_PATH)
  } else {
    await downloadFile(DOCS_INDEX_URL, ZIP_PATH)
    log('downloaded docs-index.zip (tag: ' + DOCS_INDEX_TAG + ')')
  }

  // Extract: zip contains an `index/` subdirectory at its root.
  if (force && fs.existsSync(PRECOMPUTED_DIR)) {
    fs.rmSync(PRECOMPUTED_DIR, { recursive: true, force: true })
  }
  if (!isNonEmptyDir(PRECOMPUTED_DIR)) {
    const cacheDir = path.dirname(PRECOMPUTED_DIR)
    unzipToDir(ZIP_PATH, cacheDir)
    // zip extracts to <cacheDir>/index/ -- rename to frameworks-precomputed.
    const extractedIndex = path.join(cacheDir, 'index')
    if (fs.existsSync(extractedIndex) && !fs.existsSync(PRECOMPUTED_DIR)) {
      fs.renameSync(extractedIndex, PRECOMPUTED_DIR)
    }
  }

  // Verify required files before handing off to the converter.
  for (const f of ['chunks.jsonl', 'vectors.bin', 'meta.json']) {
    if (!fs.existsSync(path.join(PRECOMPUTED_DIR, f))) {
      throw new Error(
        'docs-index.zip extraction incomplete -- ' + f + ' missing in ' +
        PRECOMPUTED_DIR + '. Delete .cache/docs-index.zip and retry.'
      )
    }
  }

  log('running build-frameworks-index.js in precomputed mode ...')
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'build-frameworks-index.js')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        FRAMEWORKS_PRECOMPUTED_DIR: PRECOMPUTED_DIR,
        FRAMEWORKS_SRC_TAG: DOCS_INDEX_TAG,
      },
    }
  )
  if (result.status !== 0) process.exit(result.status || 1)
  // build-frameworks-index.js (precomputed mode) already wrote wcag-index/ and
  // its _meta.json alongside frameworks-index/.  Touch a sentinel so that
  // ensure-wcag-index.js (if called independently e.g. during local dev) skips
  // the expensive clone+embed pass -- it checks isNonEmptyDir(OUT_DIR).
  log('precomputed build also populated wcag-index/ — ensure-wcag-index.js will skip.')
}

// --- Clone+embed fallback ----------------------------------------------------

function cloneSource() {
  log('cloning ' + REPO_URL + ' @ ' + EXPECTED_TAG + ' into ' + SRC_DIR + ' ...')
  fs.mkdirSync(path.dirname(SRC_DIR), { recursive: true })
  execFileSync(
    'git',
    ['clone', '--branch', EXPECTED_TAG, '--depth', '1', REPO_URL, SRC_DIR],
    { stdio: 'inherit' }
  )
}

function ensureEmbeddingModel() {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'ensure-embedding-model.js')],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) process.exit(result.status || 1)
}

function buildFromClone() {
  if (isNonEmptyDir(SRC_DIR)) {
    log('reusing cached checkout at ' + SRC_DIR)
  } else {
    cloneSource()
  }
  ensureEmbeddingModel()
  log('building frameworks/languages hybrid search index (chunking + embedding) ...')
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'build-frameworks-index.js')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        FRAMEWORKS_SRC_DIR: SRC_DIR,
        FRAMEWORKS_SRC_TAG: EXPECTED_TAG,
      },
    }
  )
  if (result.status !== 0) process.exit(result.status || 1)
}

// --- Entry point -------------------------------------------------------------

async function main() {
  if (!force && isNonEmptyDir(OUT_DIR)) {
    log(OUT_DIR + ' already exists -- skipping (pass --force to rebuild)')
    return
  }

  try {
    await buildFromPrecomputed()
    return
  } catch (e) {
    warn('precomputed download/extract failed: ' + e.message)
    if (noCloneFallback) {
      console.error(
        '[ensure-frameworks-index] FATAL: precomputed path failed and --no-clone-fallback is set.'
      )
      process.exit(1)
    }
    warn('falling back to clone+embed path ...')
  }

  buildFromClone()
}

main().catch((e) => {
  console.error('[ensure-frameworks-index] FATAL:', e)
  process.exit(1)
})
