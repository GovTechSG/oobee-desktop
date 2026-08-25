// Local model download + presence probe for the Gemma provider. Two models
// are exposed: E4B (~5.15 GB) for low-resource devices and 12B (~6.98 GB) for
// machines with the RAM headroom. Both are Google's official QAT Q4_0 GGUFs.
// Each model also gets its mmproj (multimodal projector) file downloaded
// alongside so `llama-server --mmproj …` can process screenshots — Gemma is
// image-capable end-to-end.
//
// Downloads use ipull directly (resumable, multi-connection, progress). We
// used to reach it via node-llama-cpp's `createModelDownloader`; since the
// switch to a spawned `llama-server` subprocess we no longer depend on
// node-llama-cpp and call ipull ourselves.

const path = require('path')
const os = require('os')
const fs = require('fs-extra')
const axios = require('axios')
const { app, ipcMain } = require('electron')

const log = (...args) => console.log('[llmModelManager]', ...args)
const warn = (...args) => console.warn('[llmModelManager]', ...args)

// Model registry. `minRamGb` gates the option in the UI — needs enough
// headroom for weights + mmproj + llama-server working set (~2 GB). Bumped
// vs. the pre-mmproj values so 12 GB machines pass E4B and 16 GB machines
// pass 12B without swapping.
const MODELS = {
  // Filenames verified against
  // https://huggingface.co/api/models/google/gemma-4-E4B-it-qat-q4_0-gguf/tree/main
  // and the 12B equivalent. mmproj naming is inconsistent between repos
  // (Google published them under different filename conventions) — the
  // registry captures the exact on-repo names.
  'gemma-e2b': {
    id: 'gemma-e2b',
    label: 'Gemma 4 E2B (QAT)',
    description: 'Smallest, fastest local model. Runs on 8 GB laptops.',
    repo: 'google/gemma-4-E2B-it-qat-q4_0-gguf',
    filename: 'gemma-4-E2B_q4_0-it.gguf',
    fallbackBytes: 3_350_000_000,
    mmprojFilename: 'gemma-4-E2B-it-mmproj.gguf',
    mmprojBytes: 987_000_000,
    minRamGb: 8,
  },
  'gemma-e4b': {
    id: 'gemma-e4b',
    label: 'Gemma 4 E4B (QAT)',
    description: 'Faster local model. Runs on 12 GB laptops.',
    repo: 'google/gemma-4-E4B-it-qat-q4_0-gguf',
    filename: 'gemma-4-E4B_q4_0-it.gguf',
    fallbackBytes: 5_154_941_280,
    mmprojFilename: 'gemma-4-E4B-it-mmproj.gguf',
    mmprojBytes: 991_552_256,
    minRamGb: 10,
    // Apple Silicon's unified memory (shared CPU/GPU pool, no separate VRAM
    // reservation) runs this comfortably on 8 GB Macs — the 10 GB default
    // was calibrated for Windows' discrete RAM/GPU split. Only applied when
    // running on darwin/arm64 (see listModels()).
    minRamGbDarwinArm64: 8,
  },
  'gemma-12b': {
    id: 'gemma-12b',
    label: 'Gemma 4 12B (QAT)',
    description: 'Better reasoning. Needs 16+ GB RAM.',
    repo: 'google/gemma-4-12B-it-qat-q4_0-gguf',
    filename: 'gemma-4-12b-it-qat-q4_0.gguf',
    fallbackBytes: 6_975_879_296,
    mmprojFilename: 'mmproj-gemma-4-12b-it-qat-q4_0.gguf',
    mmprojBytes: 175_115_616,
    minRamGb: 16,
  },
}

for (const m of Object.values(MODELS)) {
  m.weightsHttpUrl = `https://huggingface.co/${m.repo}/resolve/main/${m.filename}`
  m.mmprojHttpUrl = `https://huggingface.co/${m.repo}/resolve/main/${m.mmprojFilename}`
  m.totalBytes = m.fallbackBytes + m.mmprojBytes
}

// Per-file cache of the HuggingFace-reported size, so the download panel can
// show accurate progress before the first byte arrives.
const cachedExpectedBytes = new Map() // key: `${modelId}:${which}` → bytes

let inFlight = null // { modelId, cancel, promise }

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

function getMmprojPath(modelId) {
  return path.join(getModelsDir(), resolveModel(modelId).mmprojFilename)
}

// HEAD the resolve URL, follow redirects to the LFS CDN, and read the final
// content-length. HuggingFace also exposes `x-linked-size` on the redirect
// itself so we can often skip the second hop.
async function probeExpectedBytes(modelId, which) {
  const key = `${modelId}:${which}`
  if (cachedExpectedBytes.has(key)) return cachedExpectedBytes.get(key)
  const m = resolveModel(modelId)
  const url = which === 'mmproj' ? m.mmprojHttpUrl : m.weightsHttpUrl
  try {
    const resp = await axios.head(url, {
      maxRedirects: 5,
      timeout: 10_000,
      validateStatus: (s) => s >= 200 && s < 400,
    })
    const linked = Number(resp.headers['x-linked-size'])
    const contentLen = Number(resp.headers['content-length'])
    const size = Number.isFinite(linked) && linked > 0 ? linked : contentLen
    if (Number.isFinite(size) && size > 100 * 1024) {
      cachedExpectedBytes.set(key, size)
      return size
    }
    warn(`HEAD returned unexpected size for ${modelId}/${which}: linked=${linked}, contentLength=${contentLen}`)
  } catch (e) {
    warn(`HEAD probe failed for ${modelId}/${which}: ${e.message}`)
  }
  return null
}

// A model is "downloaded" only when BOTH files are on disk at sane sizes.
// Half-downloaded stubs (aborted mid-stream) can leave a small partial file
// — the >100 MB threshold guards against that.
async function getStatus(modelId) {
  const m = resolveModel(modelId)
  const weightsPath = getModelPath(modelId)
  const mmprojPath = getMmprojPath(modelId)

  let weightsSize = 0
  let mmprojSize = 0
  try {
    const s = await fs.stat(weightsPath)
    if (s.isFile() && s.size > 100 * 1024 * 1024) weightsSize = s.size
  } catch (_) {}
  try {
    const s = await fs.stat(mmprojPath)
    if (s.isFile() && s.size > 100 * 1024 * 1024) mmprojSize = s.size
  } catch (_) {}

  const downloaded = weightsSize > 0 && mmprojSize > 0

  if (downloaded) {
    return {
      modelId,
      downloaded: true,
      path: weightsPath,
      mmprojPath,
      sizeBytes: weightsSize + mmprojSize,
      expectedBytes: weightsSize + mmprojSize,
    }
  }

  const [remoteWeights, remoteMmproj] = await Promise.all([
    probeExpectedBytes(modelId, 'weights'),
    probeExpectedBytes(modelId, 'mmproj'),
  ])
  return {
    modelId,
    downloaded: false,
    path: weightsPath,
    mmprojPath,
    sizeBytes: weightsSize + mmprojSize,
    expectedBytes:
      (remoteWeights ?? m.fallbackBytes) + (remoteMmproj ?? m.mmprojBytes),
  }
}

async function listModels() {
  const totalGb = os.totalmem() / (1024 ** 3)
  const isMacArm64 = os.platform() === 'darwin' && os.arch() === 'arm64'
  const models = Object.values(MODELS)
  // Probe all models in parallel. Serial awaits used to make the Configure
  // dropdown look blank for a couple of seconds on Windows (6 HEAD requests
  // to huggingface.co back-to-back, each with a 10s ceiling) — worst case now
  // is one round-trip's worth of network latency instead of six.
  const statuses = await Promise.all(
    models.map((m) =>
      getStatus(m.id).catch(() => ({
        downloaded: false,
        sizeBytes: 0,
        expectedBytes: m.totalBytes,
      }))
    )
  )
  return models.map((m, i) => {
    const status = statuses[i]
    // Strict check against minRamGb (no fudge factor): os.totalmem() on
    // Windows already reports somewhat less than the nominal/marketed RAM
    // (memory reserved for firmware/hardware is excluded), so a "16 GB"
    // laptop typically reports ~15.x GB here. A previous `* 0.9` fudge
    // factor compensated for that so hard, it let 12B (minRamGb: 16) show
    // as supported on exactly-16GB machines — the opposite of the intended
    // "needs 16+ GB" gate. Keep this strict; the natural under-reporting
    // already accounts for the same headroom the fudge factor was meant to
    // provide.
    const effectiveMinRamGb =
      isMacArm64 && m.minRamGbDarwinArm64 != null ? m.minRamGbDarwinArm64 : m.minRamGb
    const supported = totalGb >= effectiveMinRamGb
    return {
      id: m.id,
      label: m.label,
      description: m.description,
      sizeBytes: status.expectedBytes,
      downloaded: status.downloaded,
      supported,
      unsupportedReason: supported
        ? null
        : `Needs ${effectiveMinRamGb}+ GB RAM (this machine has ~${totalGb.toFixed(0)} GB)`,
    }
  })
}

// Kick off a resumable download of one file via ipull. Returns the engine so
// the caller can attach progress listeners and later close() to abort.
//
// We go through ipull's top-level `downloadFile` (with cliProgress:false) —
// its package.json exports map doesn't expose the deep engine module paths, so
// importing them directly throws ERR_PACKAGE_PATH_NOT_EXPORTED under Node's
// ESM resolver. downloadFile just constructs the engine and no-ops the CLI
// wrapper when cliProgress is false, so we get the same object back either way.
async function startIpullDownload({ url, savePath }) {
  // ipull is ESM-only; keep it a dynamic import so this module stays CJS and
  // the ~mid-MB dep isn't paid for on paths that never download.
  const { downloadFile } = await import('ipull')
  const engine = await downloadFile({
    url,
    savePath,
    parallelStreams: 4,
    skipExisting: true,
    cliProgress: false,
  })
  return engine
}

async function startDownload(mainWindow, modelId) {
  if (inFlight) {
    throw new Error(`A model download is already in progress (${inFlight.modelId})`)
  }
  const m = resolveModel(modelId)
  await fs.ensureDir(getModelsDir())

  // Total-progress model: we combine bytes across the two files so the UI
  // shows one monotonic bar. Base the totals on the HEAD-probed sizes when
  // available, falling back to the manifest values.
  const weightsTotal = (await probeExpectedBytes(modelId, 'weights')) || m.fallbackBytes
  const mmprojTotal = (await probeExpectedBytes(modelId, 'mmproj')) || m.mmprojBytes
  const combinedTotal = weightsTotal + mmprojTotal
  let bytesFromCompletedFiles = 0

  const send = (payload) => {
    try {
      mainWindow?.webContents?.send('llmModel:downloadProgress', { modelId, ...payload })
    } catch (_) {
      // renderer probably gone — ignore
    }
  }

  const reportProgress = (currentFileBytes) => {
    const downloaded = bytesFromCompletedFiles + currentFileBytes
    const percent = combinedTotal > 0 ? Math.min(1, downloaded / combinedTotal) : 0
    send({ downloaded, total: combinedTotal, percent })
  }

  let activeEngine = null
  const cancel = () => {
    if (activeEngine) {
      try {
        activeEngine.close()
      } catch (_) {}
    }
  }

  const runOne = async ({ url, fileName, description }) => {
    log(`downloading ${description} (${fileName}) for ${modelId}`)
    const engine = await startIpullDownload({
      url,
      savePath: path.join(getModelsDir(), fileName),
    })
    activeEngine = engine
    engine.on('progress', (status) => {
      // ipull's progress status includes `transferredBytes` per stream — sum
      // across streams. The FormattedStatus object typically exposes
      // .transferredBytes as a total already; be defensive.
      const t = typeof status?.transferredBytes === 'number'
        ? status.transferredBytes
        : status?.bytesDownloaded || 0
      reportProgress(t)
    })
    await engine.download()
    activeEngine = null
  }

  const promise = (async () => {
    try {
      await runOne({
        url: m.weightsHttpUrl,
        fileName: m.filename,
        description: 'weights',
      })
      bytesFromCompletedFiles += weightsTotal
      await runOne({
        url: m.mmprojHttpUrl,
        fileName: m.mmprojFilename,
        description: 'mmproj (vision)',
      })
      bytesFromCompletedFiles += mmprojTotal
      send({ downloaded: combinedTotal, total: combinedTotal, percent: 1 })
      log(`downloaded ${modelId} + mmproj into ${getModelsDir()}`)
      return { ok: true, path: getModelPath(modelId), mmprojPath: getMmprojPath(modelId), modelId }
    } finally {
      inFlight = null
    }
  })()

  inFlight = { modelId, cancel, promise }
  return promise
}

function abortDownload(modelId) {
  if (inFlight && (!modelId || inFlight.modelId === modelId)) {
    log(`aborting in-flight download (${inFlight.modelId})`)
    inFlight.cancel()
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
        expectedBytes: m?.totalBytes ?? 0,
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
  getMmprojPath,
  getStatus,
  listModels,
  resolveModel,
  MODELS,
}
