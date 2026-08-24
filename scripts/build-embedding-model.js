#!/usr/bin/env node
/*
 * Download the Xenova/all-MiniLM-L6-v2 sentence-embedding model files from
 * Hugging Face and lay them out at `public/electron/embedding-model/` in the
 * directory structure that `@huggingface/transformers`'s `env.localModelPath`
 * expects (`<localModelPath>/<modelId>/<file>`).
 *
 * This model powers the runtime vector-similarity leg of the hybrid retrieval
 * pipeline in `wcagCorpus.js` / `languageFrameworksCorpus.js`. Bundling the
 * fp32 ONNX (~90 MB) preserves the app's offline-first behavior.
 *
 * Uses `curl` (shell) rather than Node's `https` — some corporate networks
 * MITM TLS with a CA that macOS/Windows system stores trust but Node's
 * bundled Mozilla CA does not. curl reads the OS trust store on all three
 * dev/CI platforms.
 *
 * Usage:
 *   node scripts/build-embedding-model.js
 *
 * Idempotent: overwrites existing files.
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const OUT_DIR = path.join(ROOT, 'public', 'electron', 'embedding-model', MODEL_ID)
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`

// The files `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')`
// resolves at load-time. `onnx/model.onnx` is the fp32 weights.
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model.onnx',
]

function log(...m) {
  console.log('[embedding-model]', ...m)
}

function fetchToFile(url, dest) {
  const result = spawnSync(
    'curl',
    [
      '-fSL',
      '--retry', '3',
      '--retry-delay', '2',
      '--progress-bar',
      '-o', dest,
      url,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  )
  if (result.status !== 0) {
    throw new Error(`curl exited ${result.status} while fetching ${url}`)
  }
}

async function main() {
  await fsp.mkdir(path.join(OUT_DIR, 'onnx'), { recursive: true })
  log(`downloading ${FILES.length} files for ${MODEL_ID} into ${OUT_DIR} …`)
  for (const relPath of FILES) {
    const dest = path.join(OUT_DIR, relPath)
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    log(`fetch ${relPath}`)
    fetchToFile(`${HF_BASE}/${relPath}`, dest)
  }
  // Validate — a truncated ONNX would fail obscurely at runtime.
  const onnxStat = fs.statSync(path.join(OUT_DIR, 'onnx', 'model.onnx'))
  if (onnxStat.size < 50 * 1024 * 1024) {
    throw new Error(
      `onnx/model.onnx is only ${onnxStat.size} bytes — expected >50MB fp32 weights`
    )
  }
  log(`DONE — ${OUT_DIR} (model.onnx: ${(onnxStat.size / 1e6).toFixed(1)} MB)`)
}

main().catch((e) => {
  console.error('[embedding-model] FATAL:', e)
  process.exit(1)
})
