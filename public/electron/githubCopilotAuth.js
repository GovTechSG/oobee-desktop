// GitHub Copilot OAuth device-flow + short-lived API-token exchange.
//
// This module is what makes the "GitHub Copilot" provider work. It has two
// jobs:
//   1. Sign the user in with GitHub via the OAuth 2.0 device authorization
//      flow (RFC 8628) so we can hold a long-lived GitHub OAuth token.
//   2. Trade that GitHub token for a short-lived Copilot chat API token
//      (~30 minute lifetime) that llmGithubCopilot.js sends on every
//      /chat/completions request, refreshing before expiry.
//
// IMPORTANT — unofficial API path. GitHub does not publish a third-party
// Copilot chat API today. The client_id below (Iv1.b507a08c87ecfe98) and
// the copilot_internal/v2/token endpoint are the same ones the official
// Copilot Chat VS Code extension uses; every open-source Copilot client
// (aider, copilot.lua, etc.) rides the same path. GitHub can tighten
// access at any time and this integration will need to change. See the
// user-facing notice in the Configure modal (ChatPage/index.jsx) which
// tells users this uses the VS Code integration path and requires an
// active Copilot subscription.

const { readUserDataFromFile, writeUserDetailsToFile } = require('./userDataManager')

const log = (...args) => console.log('[githubCopilotAuth]', ...args)
const warn = (...args) => console.warn('[githubCopilotAuth]', ...args)

// VS Code Copilot Chat's public OAuth app client_id. Not a secret — device
// flow doesn't use a client secret. Verified as the ID open-source Copilot
// clients (copilot.lua, aider, etc.) also use.
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token'

// Refresh the Copilot API token this many seconds before its stated
// expiry — small buffer so an in-flight request doesn't race the clock.
const TOKEN_REFRESH_SKEW_SECONDS = 60

// User-data keys we persist to. Kept in sync with the plan; if you rename
// these, also update llmAnalysis.js's IPC handlers and the ToS note in
// ChatPage/index.jsx.
const KEY_GITHUB_TOKEN = 'githubCopilotToken'
const KEY_COPILOT_API_TOKEN = 'githubCopilotApiToken'
const KEY_COPILOT_API_TOKEN_EXPIRES_AT = 'githubCopilotApiTokenExpiresAt'
const KEY_COPILOT_MODEL = 'githubCopilotModel'

async function startDeviceFlow() {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: 'read:user' }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub device flow start failed: HTTP ${res.status} ${text.slice(0, 300)}`)
  }
  const body = await res.json()
  if (!body.device_code || !body.user_code || !body.verification_uri) {
    throw new Error(`GitHub device flow start returned unexpected shape: ${JSON.stringify(body).slice(0, 300)}`)
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    expiresIn: body.expires_in || 900,
    interval: body.interval || 5,
  }
}

// Called by the renderer on the polling interval (see the Configure modal
// in ChatPage/index.jsx). Returns one of:
//   { pending: true }            — user hasn't authorized yet
//   { slowDown: true, interval } — GitHub asked us to poll less often
//   { ok: true }                 — success; token stored, ready to chat
//   { error: '<message>' }       — terminal failure (expired, denied)
async function pollDeviceFlow({ deviceCode }) {
  const res = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (body.error === 'authorization_pending') return { pending: true }
  if (body.error === 'slow_down') return { slowDown: true, interval: body.interval || 5 }
  if (body.error === 'expired_token') return { error: 'Sign-in timed out. Please try again.' }
  if (body.error === 'access_denied') return { error: 'Sign-in was denied.' }
  if (body.error) return { error: body.error_description || body.error }
  if (!body.access_token) {
    return { error: `Unexpected response from GitHub: ${JSON.stringify(body).slice(0, 200)}` }
  }
  writeUserDetailsToFile({
    [KEY_GITHUB_TOKEN]: body.access_token,
    // Force a fresh Copilot-token exchange on next chat send.
    [KEY_COPILOT_API_TOKEN]: '',
    [KEY_COPILOT_API_TOKEN_EXPIRES_AT]: 0,
  })
  log('device flow completed; GitHub OAuth token stored')
  return { ok: true }
}

// Returns a valid Copilot API token (short-lived, ~30 min). Uses the
// cached one if not expired; otherwise exchanges the stored GitHub OAuth
// token for a fresh Copilot token and caches it. Throws with a
// user-actionable message if the user isn't signed in or has no Copilot
// subscription — callers surface these directly.
async function getCopilotApiToken({ forceRefresh = false } = {}) {
  const userData = readUserDataFromFile()
  const githubToken = userData[KEY_GITHUB_TOKEN]
  if (!githubToken) {
    throw new Error('Not signed in to GitHub Copilot. Open Configure and sign in.')
  }
  const cachedToken = userData[KEY_COPILOT_API_TOKEN]
  const cachedExpiresAt = Number(userData[KEY_COPILOT_API_TOKEN_EXPIRES_AT] || 0)
  const nowSec = Math.floor(Date.now() / 1000)
  if (
    !forceRefresh &&
    cachedToken &&
    cachedExpiresAt > nowSec + TOKEN_REFRESH_SKEW_SECONDS
  ) {
    return { token: cachedToken, expiresAt: cachedExpiresAt }
  }
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `token ${githubToken}`,
      // Copilot's token endpoint requires an editor identity header — the
      // same one llmGithubCopilot.js sends on chat requests. Kept aligned
      // so both call sites either work or fail together.
      'Editor-Version': 'vscode/1.95.0',
      'Editor-Plugin-Version': 'copilot-chat/0.20.0',
      'User-Agent': 'GitHubCopilotChat/0.20.0',
    },
  })
  if (res.status === 401) {
    // GitHub token is dead — force sign-out state.
    writeUserDetailsToFile({
      [KEY_GITHUB_TOKEN]: '',
      [KEY_COPILOT_API_TOKEN]: '',
      [KEY_COPILOT_API_TOKEN_EXPIRES_AT]: 0,
    })
    throw new Error('GitHub sign-in expired. Please sign in again.')
  }
  if (res.status === 403 || res.status === 404) {
    // 403 = the GitHub account doesn't have an active Copilot subscription.
    // 404 has been observed for the same case; treat both identically so
    // the user gets a clear message rather than "unexpected error."
    throw new Error(
      'This GitHub account does not have an active Copilot subscription. Please subscribe at github.com/features/copilot and try again.',
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Copilot token exchange failed: HTTP ${res.status} ${text.slice(0, 300)}`)
  }
  const body = await res.json()
  if (!body.token || !body.expires_at) {
    throw new Error(`Copilot token endpoint returned unexpected shape: ${JSON.stringify(body).slice(0, 300)}`)
  }
  writeUserDetailsToFile({
    [KEY_COPILOT_API_TOKEN]: body.token,
    [KEY_COPILOT_API_TOKEN_EXPIRES_AT]: body.expires_at,
  })
  return { token: body.token, expiresAt: body.expires_at }
}

function isSignedIn() {
  const userData = readUserDataFromFile()
  return !!userData[KEY_GITHUB_TOKEN]
}

function getStoredModel() {
  const userData = readUserDataFromFile()
  return userData[KEY_COPILOT_MODEL] || ''
}

function setStoredModel(modelId) {
  writeUserDetailsToFile({
    [KEY_COPILOT_MODEL]: typeof modelId === 'string' ? modelId.trim() : '',
  })
}

function signOut() {
  writeUserDetailsToFile({
    [KEY_GITHUB_TOKEN]: '',
    [KEY_COPILOT_API_TOKEN]: '',
    [KEY_COPILOT_API_TOKEN_EXPIRES_AT]: 0,
    // Deliberately keep KEY_COPILOT_MODEL — if the user signs back in
    // they probably still want the same model as before. Same reasoning
    // OpenAI-Compatible uses (baseUrl/model persist across app restart).
  })
  log('signed out; cleared GitHub token and Copilot API token cache')
}

module.exports = {
  startDeviceFlow,
  pollDeviceFlow,
  getCopilotApiToken,
  isSignedIn,
  getStoredModel,
  setStoredModel,
  signOut,
}
