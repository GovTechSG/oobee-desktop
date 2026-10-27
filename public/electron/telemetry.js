// Single entry point for all Oobee Desktop telemetry (Sentry) and for the
// telemetry-related settings passed to the scan engine.
//
// Never call @sentry/electron directly from other modules: everything must go
// through here so the user's "opt out of accessibility scan telemetry" choice
// (userData.telemetryOptOut) is enforced in one place.
//
// When opted out:
// - Sentry.init() is never called at startup (no sessions, traces, breadcrumbs,
//   crash/minidump uploads or events).
// - captureMessage()/setUser() are no-ops.
// - If the user opts out mid-session, the already-running client is disabled
//   and closed, and beforeSend/beforeSendTransaction/beforeBreadcrumb drop
//   anything still queued.
// - Scans are spawned without -k (name/email), without OOBEE_SENTRY_DSN, and
//   with OOBEE_DISABLE_TELEMETRY=true.
//
// Opting back in takes effect on the next launch: re-initialising Sentry
// inside a running Electron process is not reliable.

const fs = require('fs')

const isOptOutValue = (value) => value === true

const createTelemetry = ({ getSentry, readUserData, log = console } = {}) => {
  let optedOut = false
  let initialised = false

  const readSavedOptOut = () => {
    try {
      const data = readUserData()
      return isOptOutValue(data && data.telemetryOptOut)
    } catch {
      return false
    }
  }

  const dropIfOptedOut = (item) => (optedOut ? null : item)

  const disableSentry = () => {
    if (!initialised) return
    try {
      const Sentry = getSentry()
      const client = Sentry.getClient && Sentry.getClient()
      // Disable before close(): close() flushes first, and we don't want
      // already-queued events or sessions to leave the device.
      if (client && typeof client.getOptions === 'function') {
        client.getOptions().enabled = false
      }
      if (typeof Sentry.close === 'function') {
        Promise.resolve(Sentry.close(0)).catch(() => {})
      }
    } catch (error) {
      log.error && log.error('[telemetry] Failed to disable Sentry:', error)
    }
  }

  const initSentry = (options = {}) => {
    optedOut = readSavedOptOut()
    if (optedOut) {
      log.log && log.log('[telemetry] Telemetry opt-out is set; Sentry is not initialised')
      return false
    }
    const Sentry = getSentry()
    Sentry.init({
      ...options,
      beforeSend: dropIfOptedOut,
      beforeSendTransaction: dropIfOptedOut,
      beforeBreadcrumb: dropIfOptedOut,
    })
    initialised = true
    return true
  }

  const setTelemetryOptOut = (value) => {
    optedOut = isOptOutValue(value)
    if (optedOut) disableSentry()
  }

  const isTelemetryOptedOut = () => optedOut

  const captureMessage = (...args) => {
    if (optedOut || !initialised) return undefined
    return getSentry().captureMessage(...args)
  }

  const setUser = (user) => {
    if (optedOut || !initialised) return
    getSentry().setUser(user)
  }

  return {
    initSentry,
    setTelemetryOptOut,
    isTelemetryOptedOut,
    captureMessage,
    setUser,
    disableSentry,
  }
}

// -k is omitted when opted out: the engine treats it as optional once
// OOBEE_DISABLE_TELEMETRY is set, but rejects a blank ":" value.
const getScanIdentityArgs = ({ name, email, telemetryOptOut }) =>
  isOptOutValue(telemetryOptOut) ? [] : ['-k', `${name}:${email}`]

const applyScanTelemetryEnv = (env, telemetryOptOut) => {
  const result = { ...env }
  if (isOptOutValue(telemetryOptOut)) {
    delete result.OOBEE_SENTRY_DSN
    result.OOBEE_DISABLE_TELEMETRY = 'true'
  }
  return result
}

const defaultTelemetry = createTelemetry({
  getSentry: () => require('@sentry/electron/main'),
  readUserData: () => {
    const { userDataFilePath } = require('./constants')
    if (!fs.existsSync(userDataFilePath)) return {}
    return JSON.parse(fs.readFileSync(userDataFilePath))
  },
})

module.exports = {
  ...defaultTelemetry,
  createTelemetry,
  getScanIdentityArgs,
  applyScanTelemetryEnv,
}
