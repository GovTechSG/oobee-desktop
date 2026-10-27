// Locale detection + userData opt-out policy. No Electron needed:
//   node --test tests/unit/*.test.*
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const Module = require('module')

const root = path.resolve(__dirname, '..', '..')

// userDataManager.js requires 'electron' and './constants' at load time.
// Stub just enough to load it so the pure policy helpers can be tested.
const loadUserDataManager = () => {
  const originalLoad = Module._load
  Module._load = function (request, parent, ...rest) {
    if (request === 'electron') {
      return { ipcMain: { handle() {}, on() {} }, dialog: {}, shell: {}, app: {} }
    }
    if (request === './constants' && parent && parent.filename.includes('electron')) {
      return { userDataFilePath: '/nonexistent/userData.txt', defaultExportDir: '/tmp' }
    }
    return originalLoad.call(this, request, parent, ...rest)
  }
  try {
    return require(path.join(root, 'public/electron/userDataManager.js'))
  } finally {
    Module._load = originalLoad
  }
}

const locale = require(path.join(root, 'public/electron/localeManager.js'))
const { applyTelemetryOptOutPolicy, isUserProfileComplete } = loadUserDataManager()

test('resolveLanguage: Japanese preferred language or regional format → ja', () => {
  assert.equal(locale.resolveLanguage({ preferredLanguages: ['ja-JP', 'en-US'] }), 'ja')
  assert.equal(locale.resolveLanguage({ preferredLanguages: ['ja'] }), 'ja')
  // Windows: English display language but Japanese regional format.
  assert.equal(locale.resolveLanguage({ preferredLanguages: ['en-US'], systemLocale: 'ja-JP' }), 'ja')
  assert.equal(locale.resolveLanguage({ preferredLanguages: [], systemLocale: 'ja_JP' }), 'ja')
})

test('resolveLanguage: everything else → en', () => {
  assert.equal(locale.resolveLanguage({ preferredLanguages: ['en-SG'], systemLocale: 'en-SG' }), 'en')
  // Japanese only as a secondary language does not switch the UI.
  assert.equal(locale.resolveLanguage({ preferredLanguages: ['en-US', 'ja-JP'], systemLocale: 'en-US' }), 'en')
  assert.equal(locale.resolveLanguage({ preferredLanguages: ['jv-ID'] }), 'en') // Javanese, not ja
  assert.equal(locale.resolveLanguage({}), 'en')
  assert.equal(locale.resolveLanguage(), 'en')
})

test('resolveLanguage: override wins and is validated', () => {
  assert.equal(locale.resolveLanguage({ override: 'ja', preferredLanguages: ['en-US'] }), 'ja')
  assert.equal(locale.resolveLanguage({ override: 'en', preferredLanguages: ['ja-JP'] }), 'en')
  assert.equal(locale.resolveLanguage({ override: 'fr', preferredLanguages: ['ja-JP'] }), 'ja')
})

test('resolveRegion: country code first, then locale region subtag', () => {
  assert.equal(locale.resolveRegion({ countryCode: 'jp' }), 'JP')
  assert.equal(locale.resolveRegion({ countryCode: 'SG', systemLocale: 'ja-JP' }), 'SG')
  assert.equal(locale.resolveRegion({ countryCode: '', systemLocale: 'en-SG' }), 'SG')
  assert.equal(locale.resolveRegion({ systemLocale: 'zh-Hant-TW' }), 'TW')
  assert.equal(locale.resolveRegion({ systemLocale: 'en' }), '')
  assert.equal(locale.resolveRegion({ override: 'us', countryCode: 'SG' }), 'US')
  assert.equal(locale.resolveRegion({ countryCode: 'invalid' }), '')
})

test('opt-out is offered only outside Singapore, or when already opted out', () => {
  assert.equal(locale.isTelemetryOptOutOffered({ region: 'JP', savedOptOut: false }), true)
  assert.equal(locale.isTelemetryOptOutOffered({ region: 'SG', savedOptOut: false }), false)
  // Unknown region keeps today's behaviour (no opt-out).
  assert.equal(locale.isTelemetryOptOutOffered({ region: '', savedOptOut: false }), false)
  // Existing opt-out stays visible so it can be reviewed / undone.
  assert.equal(locale.isTelemetryOptOutOffered({ region: 'SG', savedOptOut: true }), true)
})

test('applyTelemetryOptOutPolicy: opting out outside SG blanks name + email', () => {
  const patch = applyTelemetryOptOutPolicy(
    { name: 'A', email: 'a@b.c' },
    { name: 'A', email: 'a@b.c', telemetryOptOut: true },
    () => true
  )
  assert.deepEqual(patch, { name: '', email: '', telemetryOptOut: true })
})

test('applyTelemetryOptOutPolicy: a new opt-out in Singapore is refused', () => {
  const patch = applyTelemetryOptOutPolicy(
    { name: 'A', email: 'a@b.c' },
    { name: '', email: '', telemetryOptOut: true },
    () => false
  )
  assert.equal('telemetryOptOut' in patch, false)
})

test('applyTelemetryOptOutPolicy: an existing opt-out is kept and keeps PII blank', () => {
  // Re-saving in Singapore must not drop an existing opt-out.
  const kept = applyTelemetryOptOutPolicy({ telemetryOptOut: true }, { telemetryOptOut: true }, () => false)
  assert.equal(kept.telemetryOptOut, true)
  // A compromised renderer cannot sneak name/email back in while opted out.
  const sneaky = applyTelemetryOptOutPolicy(
    { telemetryOptOut: true, name: '', email: '' },
    { name: 'Eve', email: 'eve@x.y' },
    () => true
  )
  assert.deepEqual(sneaky, { name: '', email: '' })
})

test('applyTelemetryOptOutPolicy: opting back in is always allowed', () => {
  const patch = applyTelemetryOptOutPolicy(
    { telemetryOptOut: true },
    { name: 'A', email: 'a@b.c', telemetryOptOut: false },
    () => false
  )
  assert.deepEqual(patch, { name: 'A', email: 'a@b.c', telemetryOptOut: false })
})

test('applyTelemetryOptOutPolicy: non-boolean values are dropped', () => {
  for (const value of ['true', 1, null, {}]) {
    const patch = applyTelemetryOptOutPolicy({}, { telemetryOptOut: value }, () => true)
    assert.equal('telemetryOptOut' in patch, false, `value ${JSON.stringify(value)}`)
  }
})

test('isUserProfileComplete: opted-out users skip onboarding', () => {
  assert.equal(isUserProfileComplete({ name: '', email: '', telemetryOptOut: true }), true)
  assert.equal(isUserProfileComplete({ name: 'A', email: 'a@b.c' }), true)
  assert.equal(isUserProfileComplete({ name: '', email: '' }), false)
  assert.equal(isUserProfileComplete({ name: 'A', email: '' }), false)
})
