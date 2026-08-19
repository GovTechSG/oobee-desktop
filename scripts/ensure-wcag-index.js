#!/usr/bin/env node
/*
 * Ensures `public/electron/wcag-index/` exists before packaging, building it
 * on demand from a cached checkout of https://github.com/w3c/wcag pinned at
 * tag WCAG22-20241212.
 *
 * Runs as part of `npm run make-*` (chained before `scripts/build-wcag-index.js`
 * is invoked directly — this script clones/reuses the WCAG source checkout and
 * spawns build-wcag-index.js with WCAG_SRC_DIR pointed at it), so a fresh
 * clone of this repo can produce a working `search_wcag` tool without any
 * manual setup.
 *
 * Idempotent: skips the (slow — clone + embed ~1,200 chunks) rebuild if
 * `public/electron/wcag-index/` already exists. Pass `--force` to rebuild
 * anyway (e.g. after bumping EXPECTED_TAG).
 *
 * The WCAG source checkout is cached at `.cache/wcag-src/` and reused across
 * builds/machines-in-CI-cache — only the first build on a given machine pays
 * the clone + embedding cost.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'electron', 'wcag-index')
const SRC_DIR = path.join(ROOT, '.cache', 'wcag-src')
const REPO_URL = 'https://github.com/w3c/wcag.git'
const EXPECTED_TAG = 'WCAG22-20241212'

const force = process.argv.slice(2).includes('--force')

function log(...m) {
  console.log('[ensure-wcag-index]', ...m)
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
  log('building WCAG search index (this embeds ~1,200 chunks, may take a while) …')
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'build-wcag-index.js')],
    {
      stdio: 'inherit',
      env: { ...process.env, WCAG_SRC_DIR: SRC_DIR },
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
