#!/usr/bin/env node
/*
 * Ensures `public/electron/frameworks-index/` exists before packaging,
 * building it on demand from a cached checkout of
 * https://github.com/GovTechSG/oobee-ai-rag-index pinned at tag
 * `synced/2026-08-22`.
 *
 * Runs as part of `npm run make-*` (chained after ensure-wcag-index.js), so a
 * fresh clone of this repo can produce a working
 * `search_language_and_frameworks` tool without any manual setup.
 *
 * Idempotent: skips the (slow — clone + chunk) rebuild if
 * `public/electron/frameworks-index/` already exists. Pass `--force` to
 * rebuild anyway (e.g. after bumping EXPECTED_TAG).
 *
 * The source checkout is cached at `.cache/frameworks-src/` and reused
 * across builds / machines-in-CI-cache — only the first build on a given
 * machine pays the clone cost.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'electron', 'frameworks-index')
const SRC_DIR = path.join(ROOT, '.cache', 'frameworks-src')
const REPO_URL = 'https://github.com/GovTechSG/oobee-ai-rag-index.git'
const EXPECTED_TAG = 'synced/2026-08-22'

const force = process.argv.slice(2).includes('--force')

function log(...m) {
  console.log('[ensure-frameworks-index]', ...m)
}

function isNonEmptyDir(dir) {
  try {
    return fs.readdirSync(dir).length > 0
  } catch (e) {
    return false
  }
}

function cloneSource() {
  log(`cloning ${REPO_URL} @ ${EXPECTED_TAG} into ${SRC_DIR} …`)
  fs.mkdirSync(path.dirname(SRC_DIR), { recursive: true })
  execFileSync(
    'git',
    ['clone', '--branch', EXPECTED_TAG, '--depth', '1', REPO_URL, SRC_DIR],
    { stdio: 'inherit' }
  )
}

function ensureSourceCheckout() {
  if (isNonEmptyDir(SRC_DIR)) {
    log(`reusing cached checkout at ${SRC_DIR}`)
    return
  }
  cloneSource()
}

function buildIndex() {
  ensureSourceCheckout()
  log('building frameworks/languages search index (chunking markdown docs) …')
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'build-frameworks-index.js')],
    {
      stdio: 'inherit',
      // Pass the pinned tag through explicitly. `git describe --tags` on
      // the shallow clone can pick a moving tag (`latest-sync`) when
      // multiple tags point at the same commit — that would misrepresent
      // the actual pin recorded in `_meta.json`.
      env: {
        ...process.env,
        FRAMEWORKS_SRC_DIR: SRC_DIR,
        FRAMEWORKS_SRC_TAG: EXPECTED_TAG,
      },
    }
  )
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

if (!force && isNonEmptyDir(OUT_DIR)) {
  log(`${OUT_DIR} already exists — skipping (pass --force to rebuild)`)
  process.exit(0)
}

buildIndex()
