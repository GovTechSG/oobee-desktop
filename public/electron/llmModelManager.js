// Local model download + presence probe for the Gemma 4 E4B provider. Uses
// node-llama-cpp's `createModelDownloader` (which wraps ipull for resumable
// parallel HTTP transfers) and stores the GGUF under Electron's userData path
// so it survives app upgrades but is easy to wipe from the OS.

const path = require('path')
const fs = require('fs-extra')
const axios = require('axios')
const { app, ipcMain } = require('electron')

// Unsloth's recommended "Dynamic" quant — slightly larger than Q4_K_M but with
// better accuracy on their eval, per the model card.
const MODEL_FILENAME = 'gemma-4-E4B-it-UD-Q4_K_XL.gguf'
const MODEL_URI = 'hf:unsloth/gemma-4-E4B-it-GGUF/gemma-4-E4B-it-UD-Q4_K_XL.gguf'
// Direct HTTPS URL used for a one-shot HEAD probe so the UI can show the real
// content-length before the user starts downloading. Kept in sync with MODEL_URI.
const MODEL_HTTP_URL =
  'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/' + MODEL_FILENAME
// Last-resort fallback only used if the HEAD probe fails (offline, HF down).
// Real total is populated from the remote HEAD or streamed via onProgress.
const FALLBACK_BYTES = 5_130_000_000

let cachedExpectedBytes = null

let inFlight = null // { abort: () => void, promise: Promise }

const log = (...args) => console.log('[llmModelManager]', ...args)
const warn = (...args) => console.warn('[llmModelManager]', ...args)

function getModelsDir() {
  return path.join(app.getPath('userData'), 'models')
}

function getModelPath() {
  return path.join(getModelsDir(), MODEL_FILENAME)
}

// HEAD the resolve URL, follow redirects to the LFS CDN, and read the final
// content-length. HuggingFace also exposes `x-linked-size` on the redirect
// itself so we can often skip the second hop.
async function probeExpectedBytes() {
  if (cachedExpectedBytes) return cachedExpectedBytes
  try {
    const resp = await axios.head(MODEL_HTTP_URL, {
      maxRedirects: 5,
      timeout: 10_000,
      validateStatus: (s) => s >= 200 && s < 400,
    })
    const linked = Number(resp.headers['x-linked-size'])
    const contentLen = Number(resp.headers['content-length'])
    const size = Number.isFinite(linked) && linked > 0 ? linked : contentLen
    if (Number.isFinite(size) && size > 100 * 1024 * 1024) {
      cachedExpectedBytes = size
      log(`resolved remote size: ${size} bytes`)
      return size
    }
    warn(`HEAD returned unexpected size: linked=${linked}, contentLength=${contentLen}`)
  } catch (e) {
    warn(`HEAD probe failed: ${e.message}`)
  }
  return null
}

async function getStatus() {
  const p = getModelPath()
  try {
    const s = await fs.stat(p)
    // Guard against half-downloaded stubs — anything meaningfully smaller than
    // a few hundred MB definitely isn't the full quantised weight file.
    if (s.isFile() && s.size > 100 * 1024 * 1024) {
      // File already on disk. Skip the network HEAD — the download panel
      // won't render, and we can report the on-disk size directly.
      return { downloaded: true, path: p, sizeBytes: s.size, expectedBytes: s.size }
    }
  } catch (_) {
    // not present — fall through to remote probe
  }
  const remoteBytes = await probeExpectedBytes()
  return {
    downloaded: false,
    path: p,
    sizeBytes: 0,
    expectedBytes: remoteBytes ?? FALLBACK_BYTES,
  }
}

async function startDownload(mainWindow) {
  if (inFlight) throw new Error('A model download is already in progress')
  await fs.ensureDir(getModelsDir())

  const { createModelDownloader } = await import('node-llama-cpp')
  const abortController = new AbortController()
  const send = (payload) => {
    try {
      mainWindow?.webContents?.send('llmModel:downloadProgress', payload)
    } catch (_) {
      // renderer probably gone — ignore
    }
  }

  let downloader
  try {
    downloader = await createModelDownloader({
      modelUri: MODEL_URI,
      dirPath: getModelsDir(),
      fileName: MODEL_FILENAME,
      skipExisting: true,
      parallelDownloads: 4,
      onProgress: ({ totalSize, downloadedSize }) => {
        const total = totalSize || (cachedExpectedBytes || FALLBACK_BYTES)
        const percent = total > 0 ? Math.min(1, downloadedSize / total) : 0
        send({ downloaded: downloadedSize, total, percent })
      },
    })
  } catch (e) {
    warn(`downloader setup failed: ${e.message}`)
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
      log(`downloaded model to ${modelPath}`)
      // Nudge a final 100% progress event so the UI settles.
      const total = downloader.totalSize || (cachedExpectedBytes || FALLBACK_BYTES)
      send({ downloaded: total, total, percent: 1 })
      return { ok: true, path: modelPath }
    } finally {
      inFlight = null
    }
  })()

  inFlight = { abort, promise }
  return promise
}

function abortDownload() {
  if (inFlight) {
    log('aborting in-flight download')
    inFlight.abort()
  }
}

function init({ mainWindow }) {
  ipcMain.handle('llmModel:status', async () => {
    try {
      return await getStatus()
    } catch (e) {
      return { downloaded: false, error: e.message, path: getModelPath(), sizeBytes: 0, expectedBytes: (cachedExpectedBytes || FALLBACK_BYTES) }
    }
  })

  ipcMain.handle('llmModel:download', async () => {
    try {
      return await startDownload(mainWindow)
    } catch (e) {
      warn(`download failed: ${e.message}`)
      return { ok: false, error: e.message }
    }
  })

  ipcMain.on('llmModel:downloadAbort', () => abortDownload())
}

module.exports = { init, getModelPath, getStatus, MODEL_FILENAME }
