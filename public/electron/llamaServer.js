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

// forge.config.js copies `resources/<platform>-<arch>/llama-server/` into the
// packaged app's Resources folder, so at runtime it's always at
// `<resourcesPath>/llama-server`. In dev, use the repo-relative layout instead.
function resolveBinaryDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'llama-server')
  }
  return path.join(
    __dirname,
    '..',
    '..',
    'resources',
    `${process.platform}-${process.arch}`,
    'llama-server',
  )
}

function resolveBinaryPath() {
  const dir = resolveBinaryDir()
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return path.join(dir, exe)
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
    a.contextSize === b.contextSize
  )
}

// Compose the CLI flags. Values mirror the tuning that used to live in
// llmGemma.js: batch=2048 for prefill throughput, flash-attn on, q8_0 KV
// cache to halve decode bandwidth, all layers on GPU. `--jinja` is default
// on in recent llama-server builds so the Gemma chat template baked into the
// GGUF is used automatically.
function buildArgs({ modelPath, mmprojPath, contextSize, port }) {
  const argv = [
    '-m', modelPath,
    '-c', String(contextSize),
    '-b', '2048',
    '-fa', 'on',
    '-ctk', 'q8_0',
    '-ctv', 'q8_0',
    '-ngl', '999',
    '--jinja',
    '--host', '127.0.0.1',
    '--port', String(port),
  ]
  if (mmprojPath) {
    argv.push('-mm', mmprojPath)
  }
  return argv
}

async function ensure({ modelPath, mmprojPath, contextSize }) {
  if (!modelPath) throw new Error('llamaServer.ensure requires modelPath')
  if (!fs.existsSync(modelPath)) throw new Error(`model not found: ${modelPath}`)
  if (mmprojPath && !fs.existsSync(mmprojPath)) throw new Error(`mmproj not found: ${mmprojPath}`)

  const config = { modelPath, mmprojPath: mmprojPath || null, contextSize }
  if (current && sameConfig(current.config, config)) {
    return { baseUrl: current.baseUrl }
  }

  if (current) {
    log(`config changed — restarting server`)
    await stop()
  }

  const bin = resolveBinaryPath()
  if (!fs.existsSync(bin)) {
    throw new Error(
      `llama-server binary not found at ${bin}. ` +
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
