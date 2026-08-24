#!/usr/bin/env node
/*
 * Ensures `public/electron/embedding-model/` exists before packaging,
 * downloading the Xenova/all-MiniLM-L6-v2 fp32 ONNX model + tokenizer files
 * from Hugging Face on demand.
 *
 * Runs as part of `npm run make-*` (chained before ensure-wcag-index.js), so
 * a fresh clone of this repo can build the WCAG + frameworks vector indexes
 * without any manual setup.
 *
 * Idempotent: skips the (slow — ~90 MB) rebuild if
 * `public/electron/embedding-model/Xenova/all-MiniLM-L6-v2/onnx/model.onnx`
 * already exists. Pass `--force` to redownload.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const OUT_DIR = path.join(ROOT, 'public', 'electron', 'embedding-model', MODEL_ID)
const SENTINEL = path.join(OUT_DIR, 'onnx', 'model.onnx')

const force = process.argv.slice(2).includes('--force')

function log(...m) {
  console.log('[ensure-embedding-model]', ...m)
}

function buildModel() {
  log(`downloading ${MODEL_ID} to ${OUT_DIR} …`)
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'build-embedding-model.js')],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

if (!force && fs.existsSync(SENTINEL)) {
  log(`${SENTINEL} already exists — skipping (pass --force to redownload)`)
  process.exit(0)
}

buildModel()
