// Telemetry (Sentry + scan engine) opt-out. No Electron needed:
//   node --test tests/unit/*.test.*
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
const telemetry = require(path.join(root, 'public/electron/telemetry.js'))

test('scan args: -k is omitted when opted out', () => {
  assert.deepEqual(
    telemetry.getScanIdentityArgs({ name: 'A', email: 'a@b.c', telemetryOptOut: false }),
    ['-k', 'A:a@b.c']
  )
  assert.deepEqual(telemetry.getScanIdentityArgs({ name: '', email: '', telemetryOptOut: true }), [])
})

test('scan env: opted out removes OOBEE_SENTRY_DSN and sets OOBEE_DISABLE_TELEMETRY=true', () => {
  const base = { OOBEE_SENTRY_DSN: 'https://dsn', OOBEE_VERBOSE: '1' }
  assert.deepEqual(telemetry.applyScanTelemetryEnv(base, false), base)
  const optedOut = telemetry.applyScanTelemetryEnv(base, true)
  assert.equal('OOBEE_SENTRY_DSN' in optedOut, false)
  assert.equal(optedOut.OOBEE_DISABLE_TELEMETRY, 'true')
  assert.equal(optedOut.OOBEE_VERBOSE, '1')
  assert.equal(base.OOBEE_SENTRY_DSN, 'https://dsn', 'input must not be mutated')
})

const makeSentryStub = () => {
  const calls = { init: [], captureMessage: [], setUser: [], close: [] }
  const options = { enabled: true }
  const sentry = {
    init: (opts) => calls.init.push(opts),
    captureMessage: (...args) => calls.captureMessage.push(args),
    setUser: (user) => calls.setUser.push(user),
    close: (timeout) => {
      calls.close.push(timeout)
      return Promise.resolve(true)
    },
    getClient: () => ({ getOptions: () => options }),
  }
  return { calls, options, sentry }
}

const make = (readUserData) => {
  const stub = makeSentryStub()
  const t = telemetry.createTelemetry({ getSentry: () => stub.sentry, readUserData, log: {} })
  return { ...stub, t }
}

test('opted-out user → Sentry is never initialised and calls are no-ops', () => {
  const { calls, t } = make(() => ({ telemetryOptOut: true }))
  assert.equal(t.initSentry({ dsn: 'x' }), false)
  t.captureMessage('App Launched')
  t.setUser({ id: 'u' })
  assert.equal(calls.init.length, 0)
  assert.equal(calls.captureMessage.length, 0)
  assert.equal(calls.setUser.length, 0)
})

test('not opted out → Sentry initialised with pass-through filters', () => {
  const { calls, t } = make(() => ({}))
  assert.equal(t.initSentry({ dsn: 'x' }), true)
  assert.equal(calls.init.length, 1)
  const opts = calls.init[0]
  assert.equal(opts.dsn, 'x')
  const event = { message: 'hi' }
  assert.equal(opts.beforeSend(event), event)
  t.captureMessage('App Launched')
  t.setUser({ id: 'u' })
  assert.equal(calls.captureMessage.length, 1)
  assert.equal(calls.setUser.length, 1)
})

test('opting out mid-session disables, closes and drops everything', () => {
  const { calls, options, t } = make(() => ({}))
  t.initSentry({ dsn: 'x' })
  const opts = calls.init[0]
  t.setTelemetryOptOut(true)
  assert.equal(t.isTelemetryOptedOut(), true)
  assert.equal(options.enabled, false)
  assert.equal(calls.close.length, 1)
  assert.equal(opts.beforeSend({ message: 'x' }), null)
  assert.equal(opts.beforeSendTransaction({}), null)
  assert.equal(opts.beforeBreadcrumb({}), null)
  t.captureMessage('App Quit')
  t.setUser({ id: 'u' })
  assert.equal(calls.captureMessage.length, 0)
  assert.equal(calls.setUser.length, 0)
})

test('opting back in mid-session does not re-initialise Sentry (next launch)', () => {
  const { calls, t } = make(() => ({ telemetryOptOut: true }))
  t.initSentry({ dsn: 'x' })
  t.setTelemetryOptOut(false)
  t.captureMessage('App Quit')
  assert.equal(calls.init.length, 0)
  assert.equal(calls.captureMessage.length, 0)
})

test('only strict true counts as opted out', () => {
  for (const value of ['true', 1, 'yes']) {
    const { calls, t } = make(() => ({ telemetryOptOut: value }))
    assert.equal(t.initSentry({}), true, `value ${JSON.stringify(value)}`)
    assert.equal(calls.init.length, 1)
  }
})

test('unreadable userData does not crash startup', () => {
  const { calls, t } = make(() => {
    throw new Error('corrupt')
  })
  assert.equal(t.initSentry({}), true)
  assert.equal(calls.init.length, 1)
})

test('only telemetry.js imports @sentry/electron in the main process', () => {
  const dir = path.join(root, 'public/electron')
  const offenders = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'telemetry.js')
    .filter((f) => /require\(\s*['"]@sentry\/electron/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
  assert.deepEqual(offenders, [])
})
