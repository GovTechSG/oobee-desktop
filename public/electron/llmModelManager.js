// Local model download + presence probe for the Gemma providers. Two models
// are exposed: E4B (~5.15 GB) for low-resource devices and 12B (~6.98 GB) for
// machines with the RAM headroom. Both are Google's OFFICIAL QAT Q4_0 GGUF
// releases, pulled via node-llama-cpp's `createModelDownloader` (resumable
// parallel HTTP via ipull) and stored under Electron's userData so they
// survive app upgrades but are easy to wipe from the OS.
//
// We used to ship unsloth's Q4_K_XL / mobile-Q2_K_XL variants; switched to
// Google's own builds so the token-type metadata (`<|tool_response>` etc.)
// matches what Gemma4ChatWrapper expects and the tool-call path is reliable.

const path = require('path')
const os = require('os')
const fs = require('fs-extra')
const axios = require('axios')
const { app, ipcMain } = require('electron')

const log = (...args) => console.log('[llmModelManager]', ...args)
const warn = (...args) => console.warn('[llmModelManager]', ...args)

// Model registry. `minRamGb` gates the option in the UI — 12B needs enough
// headroom for the ~7 GB weights plus llama.cpp/Electron working set (~2 GB),
// which we round up so 16 GB machines pass and 12 GB machines don't swap.
const MODELS = {
  // Filenames below are Google's actual on-repo names, verified via
  // `GET huggingface.co/api/models/<repo>/tree/main`. The E4B repo publishes
  // `gemma-4-E4B_q4_0-it.gguf` (unusual suffix ordering) and the 12B repo
  // publishes `gemma-4-12b-it-qat-q4_0.gguf` (lowercase `12b`). Both repos
  // also ship an `mmproj-*.gguf` multimodal projection file which we do NOT
  // download — text-only chat doesn't need it.
  'gemma-e4b': {
    id: 'gemma-e4b',
    label: 'Gemma 4 E4B (QAT)',
    description: 'Faster local model. Runs on 12 GB laptops.',
    repo: 'google/gemma-4-E4B-it-qat-q4_0-gguf',
    filename: 'gemma-4-E4B_q4_0-it.gguf',
    fallbackBytes: 5_154_941_280,
    minRamGb: 8,
  },
  'gemma-12b': {
    id: 'gemma-12b',
    label: 'Gemma 4 12B (QAT)',
    description: 'Better reasoning. Needs 16+ GB RAM.',
    repo: 'google/gemma-4-12B-it-qat-q4_0-gguf',
    filename: 'gemma-4-12b-it-qat-q4_0.gguf',
    fallbackBytes: 6_975_879_296,
    minRamGb: 14,
  },
}

for (const m of Object.values(MODELS)) {
  m.uri = `hf:${m.repo}/${m.filename}`
  m.httpUrl = `https://huggingface.co/${m.repo}/resolve/main/${m.filename}`
}

// Per-model cache of the HuggingFace-reported size, so the download panel can
// show accurate progress before the first byte arrives.
const cachedExpectedBytes = new Map()

// Only one download at a time across all models — the UI enforces this too by
// disabling the model select while a download is in flight, but we belt-and-
// braces it here so a stray IPC can't start a second concurrent transfer.
let inFlight = null // { modelId, abort, promise }

function getModelsDir() {
  return path.join(app.getPath('userData'), 'models')
}

function resolveModel(modelId) {
  const m = MODELS[modelId]
  if (!m) throw new Error(`Unknown modelId "${modelId}"`)
  return m
}

function getModelPath(modelId) {
  return path.join(getModelsDir(), resolveModel(modelId).filename)
}

// HEAD the resolve URL, follow redirects to the LFS CDN, and read the final
// content-length. HuggingFace also exposes `x-linked-size` on the redirect
// itself so we can often skip the second hop.
async function probeExpectedBytes(modelId) {
  if (cachedExpectedBytes.has(modelId)) return cachedExpectedBytes.get(modelId)
  const m = resolveModel(modelId)
  try {
    const resp = await axios.head(m.httpUrl, {
      maxRedirects: 5,
      timeout: 10_000,
      validateStatus: (s) => s >= 200 && s < 400,
    })
    const linked = Number(resp.headers['x-linked-size'])
    const contentLen = Number(resp.headers['content-length'])
    const size = Number.isFinite(linked) && linked > 0 ? linked : contentLen
    if (Number.isFinite(size) && size > 100 * 1024 * 1024) {
      cachedExpectedBytes.set(modelId, size)
      log(`resolved remote size for ${modelId}: ${size} bytes`)
      return size
    }
    warn(`HEAD returned unexpected size for ${modelId}: linked=${linked}, contentLength=${contentLen}`)
  } catch (e) {
    warn(`HEAD probe failed for ${modelId}: ${e.message}`)
  }
  return null
}

async function getStatus(modelId) {
  const m = resolveModel(modelId)
  const p = getModelPath(modelId)
  try {
    const s = await fs.stat(p)
    // Guard against half-downloaded stubs — anything meaningfully smaller than
    // a few hundred MB definitely isn't the full quantised weight file.
    if (s.isFile() && s.size > 100 * 1024 * 1024) {
      return { modelId: m.id, downloaded: true, path: p, sizeBytes: s.size, expectedBytes: s.size }
    }
  } catch (_) {
    // not present — fall through to remote probe
  }
  const remoteBytes = await probeExpectedBytes(modelId)
  return {
    modelId: m.id,
    downloaded: false,
    path: p,
    sizeBytes: 0,
    expectedBytes: remoteBytes ?? m.fallbackBytes,
  }
}

// Snapshot of all models for the provider dropdown. Includes RAM-based
// support gating so the UI can grey out 12B on low-memory machines.
async function listModels() {
  const totalGb = os.totalmem() / (1024 ** 3)
  const out = []
  for (const m of Object.values(MODELS)) {
    // Fire-and-cache the size probe but don't block if it's slow — fallback
    // bytes keep the UI responsive.
    const status = await getStatus(m.id).catch(() => ({
      downloaded: false,
      sizeBytes: 0,
      expectedBytes: m.fallbackBytes,
    }))
    const supported = totalGb >= m.minRamGb * 0.9
    out.push({
      id: m.id,
      label: m.label,
      description: m.description,
      sizeBytes: status.expectedBytes,
      downloaded: status.downloaded,
      supported,
      unsupportedReason: supported ? null : `Needs ${m.minRamGb}+ GB RAM (this machine has ~${totalGb.toFixed(0)} GB)`,
    })
  }
  return out
}

async function startDownload(mainWindow, modelId) {
  if (inFlight) {
    throw new Error(`A model download is already in progress (${inFlight.modelId})`)
  }
  const m = resolveModel(modelId)
  await fs.ensureDir(getModelsDir())

  const { createModelDownloader } = await import('node-llama-cpp')
  const abortController = new AbortController()
  const send = (payload) => {
    try {
      mainWindow?.webContents?.send('llmModel:downloadProgress', { modelId, ...payload })
    } catch (_) {
      // renderer probably gone — ignore
    }
  }

  let downloader
  try {
    downloader = await createModelDownloader({
      modelUri: m.uri,
      dirPath: getModelsDir(),
      fileName: m.filename,
      skipExisting: true,
      parallelDownloads: 4,
      onProgress: ({ totalSize, downloadedSize }) => {
        const total = totalSize || cachedExpectedBytes.get(modelId) || m.fallbackBytes
        const percent = total > 0 ? Math.min(1, downloadedSize / total) : 0
        send({ downloaded: downloadedSize, total, percent })
      },
    })
  } catch (e) {
    warn(`downloader setup failed for ${modelId}: ${e.message}`)
    throw e
  }

  const abort = () => {
    try {
      abortController.abort()
    } catch (_) {}
    try {
      downloader.cancel?.()
    } catch (_) {}
  }

  const promise = (async () => {
    try {
      const modelPath = await downloader.download({ signal: abortController.signal })
      log(`downloaded ${modelId} to ${modelPath}`)
      const total = downloader.totalSize || cachedExpectedBytes.get(modelId) || m.fallbackBytes
      send({ downloaded: total, total, percent: 1 })
      return { ok: true, path: modelPath, modelId }
    } finally {
      inFlight = null
    }
  })()

  inFlight = { modelId, abort, promise }
  return promise
}

function abortDownload(modelId) {
  if (inFlight && (!modelId || inFlight.modelId === modelId)) {
    log(`aborting in-flight download (${inFlight.modelId})`)
    inFlight.abort()
  }
}

function init({ mainWindow }) {
  ipcMain.handle('llmModel:list', async () => {
    try {
      return await listModels()
    } catch (e) {
      warn(`list failed: ${e.message}`)
      return []
    }
  })

  ipcMain.handle('llmModel:status', async (_e, modelId) => {
    try {
      return await getStatus(modelId)
    } catch (e) {
      warn(`status failed for ${modelId}: ${e.message}`)
      const m = MODELS[modelId]
      return {
        modelId,
        downloaded: false,
        error: e.message,
        path: m ? getModelPath(modelId) : null,
        sizeBytes: 0,
        expectedBytes: m?.fallbackBytes ?? 0,
      }
    }
  })

  ipcMain.handle('llmModel:download', async (_e, modelId) => {
    try {
      return await startDownload(mainWindow, modelId)
    } catch (e) {
      warn(`download failed for ${modelId}: ${e.message}`)
      return { ok: false, error: e.message, modelId }
    }
  })

  ipcMain.on('llmModel:downloadAbort', (_e, modelId) => abortDownload(modelId))
}

module.exports = {
  init,
  getModelPath,
  getStatus,
  listModels,
  resolveModel,
  MODELS,
}
