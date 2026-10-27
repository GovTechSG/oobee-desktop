// Locale file + formatter tests. ESM because src/i18n/format.js is an ES
// module (bundled by react-scripts).   node --test tests/unit/
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const en = readJson('src/i18n/locales/en.json')
const ja = readJson('src/i18n/locales/ja.json')

// format.js uses ESM syntax in a .js file inside a CommonJS package, so load
// it from a temporary .mjs copy.
const loadFormat = async () => {
  const tmp = path.join(fs.mkdtempSync(path.join(root, 'tests', 'unit', '.tmp-')), 'format.mjs')
  fs.copyFileSync(path.join(root, 'src/i18n/format.js'), tmp)
  try {
    return await import(pathToFileURL(tmp).href)
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
}
const { formatMessage, translate } = await loadFormat()

const placeholders = (s) => [...s.matchAll(/\{([a-zA-Z][\w.]*)\}/g)].map((m) => m[1]).sort()
const tags = (s) => [...s.matchAll(/<([a-zA-Z]\w*)>/g)].map((m) => m[1]).sort()

test('en.json and ja.json have exactly the same keys', () => {
  const enKeys = Object.keys(en).sort()
  const jaKeys = Object.keys(ja).sort()
  assert.deepEqual(enKeys.filter((k) => !(k in ja)), [], 'missing in ja.json')
  assert.deepEqual(jaKeys.filter((k) => !(k in en)), [], 'missing in en.json')
})

test('every value is a non-empty string', () => {
  for (const [name, messages] of [['en', en], ['ja', ja]]) {
    for (const [key, value] of Object.entries(messages)) {
      assert.equal(typeof value, 'string', `${name}:${key}`)
      assert.ok(value.trim().length > 0, `${name}:${key} is empty`)
    }
  }
})

test('placeholders and rich-text tags match between languages', () => {
  for (const key of Object.keys(en)) {
    if (key.startsWith('userForm.invalidName')) continue // literal <> characters
    assert.deepEqual(placeholders(ja[key]), placeholders(en[key]), `placeholders differ: ${key}`)
    assert.deepEqual(tags(ja[key]), tags(en[key]), `tags differ: ${key}`)
  }
})

test('every t() key used in src exists in en.json', () => {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name)
      return d.isDirectory() ? walk(p) : /\.(jsx?|tsx?)$/.test(d.name) ? [p] : []
    })
  const missing = []
  for (const file of walk(path.join(root, 'src'))) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\bt\(\s*['"]([\w.-]+)['"]/g)) {
      const key = m[1]
      if (!(key in en) && !(`${key}_one` in en && `${key}_other` in en)) {
        missing.push(`${path.relative(root, file)}: ${key}`)
      }
    }
  }
  assert.deepEqual(missing, [])
})

test('formatMessage: variables, tags and missing values', () => {
  assert.equal(formatMessage('Version {version}', { version: '1.2' }), 'Version 1.2')
  assert.equal(formatMessage('Hi {name}', {}), 'Hi {name}')
  assert.equal(formatMessage('a <b>bold</b> c', {}), 'a bold c')
  const parts = formatMessage('Welcome <b>{name}</b>', { name: 'Ann', b: (inner) => ({ tag: 'b', inner }) })
  assert.deepEqual(parts, ['Welcome ', { tag: 'b', inner: 'Ann' }])
})

test('translate: falls back to English, then to the key; picks plural forms', () => {
  assert.equal(translate(ja, en, 'common.back'), '戻る')
  assert.equal(translate({}, en, 'common.back'), 'Back')
  assert.equal(translate(ja, en, 'does.not.exist'), 'does.not.exist')
  assert.equal(translate(en, en, 'scanning.scannedCount', { count: 1 }), 'Scanned: 1 page')
  assert.equal(translate(en, en, 'scanning.scannedCount', { count: 3 }), 'Scanned: 3 pages')
  assert.equal(translate(ja, en, 'scanning.scannedCount', { count: 3 }), 'スキャン済み: 3 ページ')
})

test('Japanese strings actually contain Japanese text', () => {
  const untranslatedOk = new Set([
    'common.scan', 'scanForm.urlToggle', 'home.poweredBy', 'about.appName',
    'about.licenseDesktop', 'about.licenseCli',
  ])
  const jpRe = /[\u3040-\u30ff\u4e00-\u9fff]/
  const untranslated = Object.keys(ja).filter((k) => !untranslatedOk.has(k) && !jpRe.test(ja[k]))
  assert.deepEqual(untranslated, [])
})
