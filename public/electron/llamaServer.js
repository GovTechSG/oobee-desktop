// Subprocess lifecycle for the bundled `llama-server` binary (llama.cpp).
//
// Owns exactly one server process at a time. Callers ask for a server bound to
// a specific model + mmproj + context size via `ensure()`; if the config
// matches what's already running we hand back the same handle, otherwise the
// old process is killed and a new one spawned. This mirrors the "never hold
// two 7 GB models resident" invariant that the previous node-llama-cpp path
// enforced.
//
// The server exposes an OpenAI-compatible HTTP API on 127.0.0.1:<random-port>;
// llmGemma.js talks to it. This module knows nothing about chat/tool
// semantics — just about "is the server alive, and what URL is it on".

const path = require('path')
const fs = require('fs')
const net = require('net')
const os = require('os')
const { spawn } = require('child_process')
const { app } = require('electron')

const log = (...m) => console.log('[llamaServer]', ...m)
const warn = (...m) => console.warn('[llamaServer]', ...m)

function normalizeArch(raw) {
  const arch = String(raw || '').toLowerCase()
  if (arch === 'x86' || arch === 'i386' || arch === 'i686') return 'ia32'
  if (arch === 'x86_64' || arch === 'amd64') return 'x64'
  if (arch === 'aarch64') return 'arm64'
  return arch || process.arch
}

function targetKeysForCurrentRuntime() {
  const platform = process.platform
  const arch = normalizeArch(process.arch)
  const keys = [`${platform}-${arch}`]

  // Windows-on-ARM64 can run x64 binaries via emulation, so use x64 as a
  // fallback if the native arm64 binary is missing.
  if (platform === 'win32') {
    if (arch === 'arm64') keys.push('win32-x64')
    if (arch === 'ia32') keys.push('win32-x64')
  }

  return [...new Set(keys)]
}

// forge.config.js copies `resources/<platform>-<arch>/llama-server/` into the
// packaged app's Resources folder, so at runtime it's always at
// `<resourcesPath>/llama-server`. In dev, use the repo-relative layout instead.
function resolveBinaryDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'llama-server')
  }
  const roots = targetKeysForCurrentRuntime().map((key) => path.join(
    __dirname,
    '..',
    '..',
    'resources',
    key,
    'llama-server',
  ))

  for (const dir of roots) {
    if (fs.existsSync(dir)) return dir
  }
  return roots[0]
}

function resolveBinaryPath() {
  const dir = resolveBinaryDir()
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return path.join(dir, exe)
}

function resolveBinaryCandidates() {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  if (app.isPackaged) {
    return [path.join(process.resourcesPath, 'llama-server', exe)]
  }
  return targetKeysForCurrentRuntime().map((key) =>
    path.join(__dirname, '..', '..', 'resources', key, 'llama-server', exe),
  )
}

let attemptedDevFetch = false
function runNodeScript(script, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    // Do not use spawnSync in Electron main process: binary bootstrap may need
    // download/extract and a synchronous child blocks the UI event loop.
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })

    const pipeLogs = (stream, level) => {
      stream.setEncoding('utf8')
      let buf = ''
      stream.on('data', (chunk) => {
        buf += chunk
        let nl
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line) level(`[fetch-llama-binaries] ${line}`)
        }
      })
      stream.on('end', () => {
        const tail = buf.trim()
        if (tail) level(`[fetch-llama-binaries] ${tail}`)
      })
    }
    pipeLogs(child.stdout, log)
    pipeLogs(child.stderr, warn)

    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
}

async function tryFetchBinaryInDev() {
  if (app.isPackaged || attemptedDevFetch) return
  // One-shot guard: avoid repeated download attempts in a bad-network loop.
  attemptedDevFetch = true

  const script = path.join(__dirname, '..', '..', 'scripts', 'fetch-llama-binaries.js')
  if (!fs.existsSync(script)) return

  const cwd = path.join(__dirname, '..', '..')
  for (const key of targetKeysForCurrentRuntime()) {
    log(`llama-server binary missing; attempting dev fetch for ${key}`)
    const exitCode = await runNodeScript(script, ['--target', key], {
      cwd,
      env: process.env,
    })
    if (exitCode === 0) {
      const found = resolveBinaryCandidates().find((candidate) => fs.existsSync(candidate))
      if (found) {
        log(`downloaded llama-server for ${key}`)
        return
      }
    } else {
      warn(`fetch for ${key} failed with exit code ${exitCode}`)
    }
  }
}

// Ask the OS for a free ephemeral port. Small TOCTOU window between close()
// and llama-server bind(), but this is a dev/single-user machine — nothing
// else is racing us for localhost ports.
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

function waitForHealth(baseUrl, { signal, timeoutMs = 60_000, intervalMs = 300 }) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (signal?.aborted) return reject(new Error('aborted'))
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`llama-server did not become ready within ${timeoutMs}ms`))
      }
      try {
        const res = await fetch(`${baseUrl}/health`, { signal })
        if (res.ok) return resolve()
      } catch (_) {
        // server not up yet — keep polling
      }
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

let current = null // { config, proc, baseUrl, exitPromise }

function sameConfig(a, b) {
  if (!a || !b) return false
  return (
    a.modelPath === b.modelPath &&
    (a.mmprojPath || null) === (b.mmprojPath || null) &&
    a.contextSize === b.contextSize &&
    !!a.cpuOnly === !!b.cpuOnly
  )
}

// Compose the CLI flags. Values mirror the tuning that used to live in
// llmGemma.js: batch=2048 for prefill throughput, flash-attn on, q8_0 KV
// cache to halve decode bandwidth, all layers on GPU. `--jinja` is default
// on in recent llama-server builds so the Gemma chat template baked into the
// GGUF is used automatically.
//
// `-fa off` was tried (2026-08-19) to test a hypothesis that flash attention
// was forcing prompt processing (prefill) to fall back to CPU on win32-arm64
// (Adreno OpenCL) -- field data showed prefill at 0% GPU / 80% CPU vs decode
// at 53% GPU / 80% CPU, and a warmup warning ("flash attention is enabled /
// please report this on github as an issue",
// https://github.com/ggml-org/llama.cpp/pull/16837#issuecomment-3461676118)
// suggested a rough edge on this backend. Result: `-fa off` made llama-server
// fail to create the context outright (`failed to create context with
// model...`, exit code 1) -- reverted immediately. Root cause: quantized KV
// cache (`-ctk q8_0 -ctv q8_0` below) is only implemented via the
// flash-attention kernel path in this llama.cpp build; disabling `-fa` while
// keeping quantized KV types is an unsupported combination, not just a
// slower one. `-fa` is therefore a hard requirement here, not an
// independently-toggleable lever -- the 0%-GPU-during-prefill question
// remains open and would need `-ctk/-ctv f16` (full KV cache, more memory)
// to test flash-attention on/off in isolation, which is a separate
// memory/quality tradeoff of its own.
//
// KV-cache / slot-reuse tuning (`-np 1`, `--cache-reuse`): llama-server
// already has a per-slot prompt cache keyed on longest-common-prefix (LCP)
// with whatever it last decoded — that's the "selected slot by LCP
// similarity, f_sim_best=..." log line. It defaults to n_slots=4, which
// exists for serving multiple concurrent conversations. This app only ever
// runs one local Gemma conversation at a time, so multi-slot selection is
// pure downside here: our one conversation can bounce between slots, and a
// low f_sim_best match still "succeeds" (picks *a* slot) without actually
// reusing our cached prefix — forcing a full prompt reprocess from token 0
// (the long "prompt processing" phases + high CPU seen in practice).
// `-np 1` pins everything to a single slot so the same physical KV cache is
// always addressed — reuse becomes deterministic instead of heuristic.
// `--cache-reuse 256` additionally lets llama-server reuse cached KV chunks
// of >=256 tokens even when the new prompt only partially matches the
// cached prefix (e.g. a tool result got appended) via context-shifting,
// instead of requiring a byte-identical prefix to reuse anything.
//
// Memory note: this does NOT require retuning `pickContextSize()`'s RAM
// tiers in llmGemma.js. Server logs already showed `kv_unified = 'true'`
// even under the old n_slots=4 default, meaning the KV buffer was shared
// across slots rather than multiplied by 4 — `n_ctx_slot` came out equal to
// the full requested `-c` value, not divided. So the `reservedGB = 8`
// headroom math in `pickContextSize()` was already calibrated against
// effectively single-slot memory usage; `-np 1` mainly removes the LCP
// slot-selection ambiguity, it isn't a meaningful memory win on its own.
function buildArgs({ modelPath, mmprojPath, contextSize, port, cpuOnly }) {
  const argv = [
    '-m', modelPath,
    '-c', String(contextSize),
    '-b', '2048',
    '-fa', 'on',
    '-ctk', 'q8_0',
    '-ctv', 'q8_0',
    // CPU-only mode (user-selected "(CPU-only mode)" model option, Windows
    // only): -ngl 0 keeps every layer on CPU instead of the GPU backend.
    // Community benchmarking (ggml-org/llama.cpp discussion #8273) found
    // llama.cpp's ARM-optimized CPU kernels frequently match or beat the
    // Adreno OpenCL backend on Snapdragon X hardware for standard Q4_0
    // models, so this is a real alternative, not just a fallback.
    '-ngl', cpuOnly ? '0' : '999',
    '-np', '1',
    '--cache-reuse', '256',
    '--jinja',
    '--host', '127.0.0.1',
    '--port', String(port),
  ]
  if (mmprojPath) {
    argv.push('-mm', mmprojPath)
  }
  return argv
}

async function ensure({ modelPath, mmprojPath, contextSize, cpuOnly }) {
  if (!modelPath) throw new Error('llamaServer.ensure requires modelPath')
  if (!fs.existsSync(modelPath)) throw new Error(`model not found: ${modelPath}`)
  if (mmprojPath && !fs.existsSync(mmprojPath)) throw new Error(`mmproj not found: ${mmprojPath}`)

  const config = { modelPath, mmprojPath: mmprojPath || null, contextSize, cpuOnly: !!cpuOnly }
  if (current && sameConfig(current.config, config)) {
    return { baseUrl: current.baseUrl }
  }

  if (current) {
    log(`config changed — restarting server`)
    await stop()
  }

  let bin = resolveBinaryPath()
  if (!fs.existsSync(bin)) {
    await tryFetchBinaryInDev()
    const found = resolveBinaryCandidates().find((candidate) => fs.existsSync(candidate))
    if (found) bin = found
  }

  if (!fs.existsSync(bin)) {
    const searched = resolveBinaryCandidates().join(', ')
    throw new Error(
      `llama-server binary not found at ${bin}. ` +
        `Searched: ${searched}. ` +
        `In dev, run 'node scripts/fetch-llama-binaries.js' first. ` +
        `In a packaged build, verify forge.config.js copied the right platform folder into resources.`,
    )
  }

  const port = await pickFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const args = buildArgs({ ...config, port })

  log(`spawning ${path.basename(bin)} on ${baseUrl}`)
  log(`args: ${args.join(' ')}`)
  const proc = spawn(bin, args, {
    cwd: path.dirname(bin),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // llama-server logs to stderr; keep stdout clean.
      LLAMA_LOG_COLORS: '0',
    },
  })

  const tail = (stream, level) => {
    stream.setEncoding('utf8')
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line.trim()) level(`[llama-server] ${line}`)
      }
    })
    stream.on('end', () => {
      if (buf.trim()) level(`[llama-server] ${buf}`)
    })
  }
  tail(proc.stdout, log)
  tail(proc.stderr, log)

  const exitPromise = new Promise((resolve) => {
    proc.once('exit', (code, sig) => {
      log(`server exited (code=${code}, signal=${sig})`)
      if (current && current.proc === proc) current = null
      resolve({ code, sig })
    })
  })

  current = { config, proc, baseUrl, exitPromise }

  try {
    const healthAbort = new AbortController()
    // If the process dies while we're waiting for /health, abort the poll so we
    // fail fast instead of hitting the 60s timeout.
    exitPromise.then(() => healthAbort.abort())
    await waitForHealth(baseUrl, { signal: healthAbort.signal })
    log(`server ready`)
  } catch (e) {
    // If health failed, make sure the process is gone before returning.
    await stop().catch(() => {})
    throw new Error(`llama-server failed to start: ${e.message}`)
  }

  return { baseUrl }
}

function stop() {
  const c = current
  if (!c) return Promise.resolve()
  current = null
  try {
    c.proc.kill('SIGTERM')
  } catch (e) {
    warn(`kill SIGTERM failed: ${e.message}`)
  }
  // Give it 3s to exit gracefully, then SIGKILL.
  const killTimer = setTimeout(() => {
    try {
      c.proc.kill('SIGKILL')
    } catch (_) {}
  }, 3000)
  return c.exitPromise.finally(() => clearTimeout(killTimer))
}

function baseUrl() {
  return current?.baseUrl || null
}

function running() {
  return !!current
}

// Best-effort: kill the server when the Electron app is quitting so we don't
// leave a llama-server process orphaned on the user's machine.
if (app && typeof app.on === 'function') {
  app.on('will-quit', () => {
    if (current) {
      try {
        current.proc.kill('SIGTERM')
      } catch (_) {}
    }
  })
}

module.exports = {
  ensure,
  stop,
  baseUrl,
  running,
  resolveBinaryPath,
}
