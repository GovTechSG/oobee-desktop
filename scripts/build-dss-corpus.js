#!/usr/bin/env node
/*
 * Fetch the Singapore Digital Service Standards (DSS) Control Catalog from
 * https://info.standards.tech.gov.sg/control-catalog/dss/<code>/ and write
 * one JSON file per category into `.cache/dss/`, plus a `manifest.json`
 * listing all categories and controls. This corpus is consumed by
 * `build-wcag-index.js` and folded into the same on-disk index that backs
 * the `search_wcag` LLM tool, so queries like "WP-1", "WCAG - Perceivable",
 * or "target size DSS" surface the DSS control alongside WCAG source text.
 *
 * The 9 DSS categories:
 *   bd - Baseline Design Practices
 *   pr - Performance and Reliability
 *   tx - Transactions and Payments
 *   tl - Trust and Legitimacy
 *   uu - Understand Users
 *   wo - WCAG : Operable
 *   wp - WCAG : Perceivable
 *   wr - WCAG : Robust
 *   wu - WCAG : Understandable
 *
 * Each category page renders all its controls (WP-1, WP-2, …) inline, each
 * anchored by a hash id on its `<h2>`. We extract the h2 label ("WP-1: …"),
 * the anchor hash, and the flow of `<h3>` sub-sections + `<p>`/`<ul>` bodies
 * that follow until the next `<h2>` — that block is the control body.
 *
 * Idempotent: skips the network fetch if `.cache/dss/manifest.json` already
 * exists. Pass `--force` to refetch (e.g. after DSS content updates).
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const cheerio = require('cheerio')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, '.cache', 'dss')
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json')

const BASE_URL = 'https://info.standards.tech.gov.sg/control-catalog/dss'

const CATEGORIES = [
  { code: 'bd', name: 'Baseline Design Practices' },
  { code: 'pr', name: 'Performance and Reliability' },
  { code: 'tx', name: 'Transactions and Payments' },
  { code: 'tl', name: 'Trust and Legitimacy' },
  { code: 'uu', name: 'Understand Users' },
  { code: 'wo', name: 'WCAG : Operable' },
  { code: 'wp', name: 'WCAG : Perceivable' },
  { code: 'wr', name: 'WCAG : Robust' },
  { code: 'wu', name: 'WCAG : Understandable' },
]

const force = process.argv.slice(2).includes('--force')

function log(...m) {
  console.log('[dss-corpus]', ...m)
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      // Some CDNs 403 the default Node UA.
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return res.text()
}

function nodeToMarkdown($, node) {
  const el = $(node)
  const tag = (node.tagName || node.name || '').toLowerCase()
  if (tag === 'h3' || tag === 'h4') {
    return `\n### ${el.text().trim()}\n`
  }
  if (tag === 'p') {
    // Preserve inline bold labels like "**Group:** WCAG - Perceivable".
    const clone = el.clone()
    clone.find('b, strong').each((_, b) => {
      const txt = $(b).text().trim()
      $(b).replaceWith(`**${txt}**`)
    })
    const t = clone
      .text()
      .replace(/\s+/g, ' ')
      .trim()
    return t ? `\n${t}\n` : ''
  }
  if (tag === 'ul' || tag === 'ol') {
    const lines = []
    el.children('li').each((_, li) => {
      lines.push(`- ${$(li).text().trim().replace(/\s+/g, ' ')}`)
    })
    return lines.length ? `\n${lines.join('\n')}\n` : ''
  }
  if (tag === 'blockquote') {
    return `\n> ${el.text().trim().replace(/\s+/g, ' ')}\n`
  }
  // Unknown / decorative tag: fall back to text if it has any.
  const t = el.text().trim().replace(/\s+/g, ' ')
  return t ? `\n${t}\n` : ''
}

function extractControls($, categoryCode) {
  const controls = []
  // Controls are `<h2 id="..." class="prose-display-sm …">CODE-N: Title</h2>`
  // followed by sibling <h3>/<p>/<ul> up to the next <h2>. Look them up by
  // the class selector to avoid matching layout <h2>s that lack an id.
  const h2s = $('h2.prose-display-sm').filter((_, el) => {
    const label = $(el).text().trim()
    return /^[A-Z]{2}-\d+:\s+/.test(label)
  })

  h2s.each((_, h2) => {
    const $h2 = $(h2)
    const anchor = $h2.attr('id') || ''
    const label = $h2.text().trim()
    const m = label.match(/^([A-Z]{2}-\d+):\s+(.+)$/)
    if (!m) return
    const code = m[1]
    const title = m[2].trim()

    // Collect siblings between this <h2> and the next <h2> as the body.
    const buf = []
    let cursor = h2.nextSibling
    while (cursor) {
      const tag = (cursor.tagName || cursor.name || '').toLowerCase()
      if (tag === 'h2') break
      // cheerio wraps nodes; skip text nodes and unknown types.
      if (cursor.type === 'tag') {
        buf.push(nodeToMarkdown($, cursor))
      }
      cursor = cursor.nextSibling
    }

    const body = buf
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    controls.push({
      code,
      title,
      anchor,
      url: `${BASE_URL}/${categoryCode}/#${anchor}`,
      body,
    })
  })

  return controls
}

async function scrapeCategory(cat) {
  const url = `${BASE_URL}/${cat.code}/`
  log(`fetching ${url}`)
  const html = await fetchText(url)
  const $ = cheerio.load(html)

  const categoryTitle =
    $('h1.prose-display-lg').first().text().trim() || cat.name
  const categoryDescription =
    $('p.prose-title-lg-regular').first().text().trim() || ''
  const controls = extractControls($, cat.code)

  if (!controls.length) {
    throw new Error(
      `no controls parsed for category ${cat.code} — DSS page shape may have changed`
    )
  }
  log(`  ${cat.code}: ${controls.length} controls`)

  return {
    code: cat.code,
    title: categoryTitle,
    description: categoryDescription,
    url: `${BASE_URL}/${cat.code}/`,
    controls,
  }
}

async function main() {
  if (!force && fs.existsSync(MANIFEST_PATH)) {
    log(`${MANIFEST_PATH} exists — skipping (pass --force to refetch)`)
    return
  }

  await fsp.mkdir(OUT_DIR, { recursive: true })

  const manifest = { fetchedAt: new Date().toISOString(), categories: [] }
  for (const cat of CATEGORIES) {
    const result = await scrapeCategory(cat)
    const filePath = path.join(OUT_DIR, `${cat.code}.json`)
    await fsp.writeFile(filePath, JSON.stringify(result, null, 2) + '\n')
    manifest.categories.push({
      code: result.code,
      title: result.title,
      controlCount: result.controls.length,
      file: `${cat.code}.json`,
    })
  }

  await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  const total = manifest.categories.reduce((a, c) => a + c.controlCount, 0)
  log(`wrote ${manifest.categories.length} categories, ${total} controls to ${OUT_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
