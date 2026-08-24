/*
 * Xenova/all-MiniLM-L6-v2 sentence-embedding singleton.
 *
 * Used by the hybrid retrieval path in `wcagCorpus.js` and
 * `languageFrameworksCorpus.js` to embed user queries at runtime and fuse
 * cosine-similarity ranking with BM25 via RRF.
 *
 * The model files are bundled under `public/electron/embedding-model/` by
 * `scripts/ensure-embedding-model.js` and shipped inside the asar-unpacked
 * tree, so this loads offline. If the directory is missing (dev checkout
 * without the model), `isAvailable()` returns false and callers fall back
 * to pure BM25.
 *
 * The first `embed()` call warms up the ONNX runtime (~2-5s); subsequent
 * calls are ~40-80ms each on CPU.
 */

const fs = require('fs')
const path = require('path')

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

// Resolve the bundled model root directly rather than via constants.js —
// constants.js pulls in Electron APIs at load time, but this module is
// also used by the build scripts (Node CLI). The layout is the same in
// both worlds: `public/electron/embedding-model/`.
function getEmbeddingModelPath() {
  const p = path.join(__dirname, 'embedding-model')
  return fs.existsSync(p) ? p : null
}

let pipelinePromise = null
let warned = false

// Cache the availability check — used per-query in the hot path.
let cachedAvailable = null
function isAvailable() {
  if (cachedAvailable !== null) return cachedAvailable
  cachedAvailable = getEmbeddingModelPath() !== null
  if (!cachedAvailable && !warned) {
    console.warn(
      '[embeddings] embedding-model dir not found — hybrid search will run BM25-only'
    )
    warned = true
  }
  return cachedAvailable
}

async function getPipeline() {
  if (pipelinePromise) return pipelinePromise

  const modelRoot = getEmbeddingModelPath()
  if (!modelRoot) {
    throw new Error('embedding-model directory not found')
  }

  pipelinePromise = (async () => {
    // Lazy-require so a dev checkout without the dependency installed still
    // boots the app — isAvailable() gates callers before we get here anyway.
    const transformers = await import('@huggingface/transformers')
    const { env, pipeline } = transformers
    env.localModelPath = modelRoot
    env.allowRemoteModels = false
    // Prefer WASM for portability on Electron main-process. GPU providers
    // aren't available here and CPU path is fast enough for a 22M-param model.
    if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
      env.backends.onnx.wasm.numThreads = 1
    }
    const t0 = Date.now()
    console.log(`[embeddings] warming up ${MODEL_ID} …`)
    const extractor = await pipeline('feature-extraction', MODEL_ID, {
      quantized: false,
    })
    console.log(`[embeddings] ready (${Date.now() - t0}ms)`)
    return extractor
  })()

  return pipelinePromise
}

// Embed a single text into an L2-normalized Float32Array (384 dims for MiniLM).
async function embed(text) {
  const extractor = await getPipeline()
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  // `output.data` is a Float32Array of length 384 for MiniLM-L6.
  return output.data instanceof Float32Array
    ? output.data
    : new Float32Array(output.data)
}

// Batched variant for build-time indexing. Returns Float32Array[] of length
// `texts.length`, each L2-normalized.
async function embedBatch(texts) {
  const extractor = await getPipeline()
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  // Tensor shape: [texts.length, 384]. Slice into per-row Float32Arrays.
  const [n, dim] = output.dims
  const flat = output.data
  const rows = new Array(n)
  for (let i = 0; i < n; i++) {
    rows[i] = new Float32Array(flat.buffer, flat.byteOffset + i * dim * 4, dim).slice()
  }
  return rows
}

module.exports = { embed, embedBatch, isAvailable, MODEL_ID }
