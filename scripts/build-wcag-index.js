#!/usr/bin/env node
/*
 * Build a BM25 + vector search index for WCAG 2.2 documentation.
 *
 * Reads Understanding docs + Techniques + Failures from a local checkout of
 * https://github.com/w3c/wcag pinned at tag `WCAG22-20241212`, chunks each
 * page by top-level <section id="…">, and writes `<uuid>.pb` (JSON metadata)
 * + `<uuid>.txt` (chunk body) + `<uuid>.vec` (384-dim fp32 L2-normalized
 * Xenova/all-MiniLM-L6-v2 embedding) triples to `public/electron/wcag-index/`
 * — the on-disk layout that `wcagCorpus.js` reads for hybrid BM25+vector
 * search at runtime.
 *
 * Also pulls Singapore DSS controls (via oobee's DETAILS.md → dssToWcag map)
 * and the DETAILS.md file itself into the same corpus.
 *
 * Usage:
 *   WCAG_SRC_DIR=/Users/young/wcag node scripts/build-wcag-index.js
 *
 * WCAG_SRC_DIR defaults to /Users/young/wcag. Requires the checkout to be at
 * (or descend from) tag WCAG22-20241212 — the script warns otherwise.
 *
 * The obsoleted SC 4.1.1 Parsing is excluded — it was removed in WCAG 2.2.
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const cheerio = require('cheerio')

const SRC_DIR = process.env.WCAG_SRC_DIR || '/Users/young/wcag'
const OUT_DIR = path.join(__dirname, '..', 'public', 'electron', 'wcag-index')
const DSS_DIR = path.join(__dirname, '..', '.cache', 'dss')
const DETAILS_MD_PATH = path.join(__dirname, '..', '.cache', 'oobee-DETAILS.md')
const DETAILS_MD_URL =
  'https://github.com/GovTechSG/oobee/blob/master/DETAILS.md'
const EXPECTED_TAG = 'WCAG22-20241212'
const OBSOLETED_UNDERSTANDING = new Set(['parsing.html']) // WCAG 4.1.1, removed in 2.2

const UNDERSTANDING_VERSIONS = ['20', '21', '22']
const INDEX_PAGE_NAMES = new Set([
  'index.html',
  'intro.html',
  'about.html',
  'conformance.html',
  'documenting-accessibility-support.html',
  'refer-to-wcag.html',
  'understanding-act-rules.html',
  'understanding-metadata.html',
  'understanding-techniques.html',
  'understanding-template.html',
  'techniques.11tydata.js',
  'understanding.11tydata.js',
  'understanding.d.ts',
  'understanding.css',
  'about.html',
  'technique-template.html',
  'changelog.html',
  'changelog.11tydata.json',
  'techniques.css',
])

const TECHNIQUE_CATEGORIES = [
  'aria',
  'client-side-script',
  'css',
  'failures',
  'flash',
  'general',
  'html',
  'pdf',
  'server-side-script',
  'silverlight',
  'smil',
  'text',
]

const WCAG_BASE = 'https://www.w3.org/WAI/WCAG22'

function verifyCheckout() {
  try {
    const describe = execSync('git describe --tags', { cwd: SRC_DIR }).toString().trim()
    if (!describe.startsWith(EXPECTED_TAG)) {
      console.warn(
        `[wcag-index] WARNING: checkout is at "${describe}", expected tag "${EXPECTED_TAG}".\n` +
          `Run: git -C ${SRC_DIR} checkout ${EXPECTED_TAG}`
      )
    } else {
      console.log(`[wcag-index] source checkout: ${describe}`)
    }
  } catch (e) {
    console.warn(`[wcag-index] could not verify checkout (${e.message}) — continuing`)
  }
}

function extractText($, node) {
  // Preserve <h2>/<h3>/<h4> as section headers, otherwise flatten to text.
  const clone = $(node).clone()
  clone.find('link, script, style').remove()
  clone.find('pre code').each((_, el) => {
    const text = $(el).text()
    $(el).replaceWith('\n```\n' + text + '\n```\n')
  })
  clone.find('code').each((_, el) => {
    $(el).replaceWith('`' + $(el).text() + '`')
  })
  clone.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = el.tagName.toLowerCase()
    const level = Number(tag.slice(1))
    $(el).prepend('\n' + '#'.repeat(level) + ' ')
    $(el).append('\n')
  })
  clone.find('li').each((_, el) => {
    $(el).prepend('- ')
    $(el).append('\n')
  })
  clone.find('p, dt, dd, figcaption').each((_, el) => {
    $(el).append('\n')
  })
  return clone
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function chunkPage($, filePath, meta) {
  // A "chunk" is either a top-level <section id="..."> inside <body>, or
  // (for pages without top-level sections) the whole body.
  const chunks = []
  const body = $('body').first()
  const topSections = body.children('section[id]')
  const h1 = $('h1').first().text().trim()

  if (topSections.length === 0) {
    const text = extractText($, body)
    if (text.length > 40) {
      chunks.push({
        text: (h1 ? `# ${h1}\n\n` : '') + text,
        sectionId: 'body',
        sectionTitle: h1 || meta.slug,
      })
    }
    return { chunks, title: h1 }
  }

  topSections.each((_, section) => {
    const $section = $(section)
    const id = $section.attr('id')
    // Skip <section class="meta"> boilerplate blocks.
    if (($section.attr('class') || '').split(' ').includes('meta')) return
    const heading = $section
      .children('h2, h3, h4, h5, h6')
      .first()
      .text()
      .trim()
    const text = extractText($, section)
    if (text.length < 40) return
    chunks.push({
      text: `# ${h1}\n\n## ${heading || id}\n\n${text}`,
      sectionId: id,
      sectionTitle: heading || id,
    })
  })

  return { chunks, title: h1 }
}

function urlForUnderstanding(slug) {
  return `${WCAG_BASE}/Understanding/${slug}.html`
}

function urlForTechnique(category, id) {
  return `${WCAG_BASE}/Techniques/${category}/${id}`
}

async function collectUnderstandingPages() {
  const pages = []
  for (const version of UNDERSTANDING_VERSIONS) {
    const dir = path.join(SRC_DIR, 'understanding', version)
    let entries = []
    try {
      entries = await fsp.readdir(dir)
    } catch (e) {
      console.warn(`[wcag-index] skipping missing dir: ${dir}`)
      continue
    }
    for (const name of entries) {
      if (!name.endsWith('.html')) continue
      if (INDEX_PAGE_NAMES.has(name)) continue
      if (OBSOLETED_UNDERSTANDING.has(name)) continue
      const slug = name.replace(/\.html$/, '')
      const filePath = path.join(dir, name)
      pages.push({
        filePath,
        docType: 'understanding',
        slug,
        wcagVersion: `2.${Number(version) - 20}`, // 20→2.0, 21→2.1, 22→2.2
        url: urlForUnderstanding(slug),
      })
    }
  }
  return pages
}

async function collectTechniquePages() {
  const pages = []
  for (const category of TECHNIQUE_CATEGORIES) {
    const dir = path.join(SRC_DIR, 'techniques', category)
    let entries = []
    try {
      entries = await fsp.readdir(dir)
    } catch (e) {
      continue
    }
    for (const name of entries) {
      if (!name.endsWith('.html')) continue
      if (INDEX_PAGE_NAMES.has(name)) continue
      const id = name.replace(/\.html$/, '')
      const filePath = path.join(dir, name)
      pages.push({
        filePath,
        docType: category === 'failures' ? 'failure' : 'technique',
        techId: id,
        category,
        url: urlForTechnique(category, id),
      })
    }
  }
  return pages
}

// ---- DSS (Digital Service Standards) control catalog ingestion ----
//
// The scraper writes one JSON per category to `.cache/dss/<code>.json` plus
// a `manifest.json`. Each control becomes one chunk in the index, with
// metadata.techId set to the DSS code ("WP-1") so wcagCorpus.js's tokenizer
// gives it the same TITLE_BOOST treatment as WCAG technique ids ("G54").
// A user query for "WP-1" therefore lands on the DSS control directly.

function urlForDss(categoryCode, anchor) {
  return `https://info.standards.tech.gov.sg/control-catalog/dss/${categoryCode}/#${anchor}`
}

async function collectDssControls(dssToWcagMap) {
  const manifestPath = path.join(DSS_DIR, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    console.warn(
      `[wcag-index] no DSS corpus at ${DSS_DIR} — skipping DSS ingestion. ` +
        'Run `node scripts/build-dss-corpus.js` first.'
    )
    return { chunks: [], catalog: null }
  }
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
  const chunks = []
  const catalog = { fetchedAt: manifest.fetchedAt, categories: [] }
  for (const cat of manifest.categories) {
    const catData = JSON.parse(
      await fsp.readFile(path.join(DSS_DIR, cat.file), 'utf8')
    )
    catalog.categories.push({
      code: catData.code,
      title: catData.title,
      description: catData.description || '',
      url: catData.url || '',
      controlCount: catData.controls.length,
      controls: catData.controls.map((c) => ({
        code: c.code,
        title: c.title,
        url: c.url,
        wcagRefs: dssToWcagMap.get(c.code) || [],
      })),
    })
    for (const control of catData.controls) {
      // Enrich each control's body with the WCAG mapping we derived from
      // Oobee's DETAILS.md. This is what turns "WP-1" into "WP-1 → WCAG 1.1.1"
      // in the retrieved snippet without requiring the model to make a second
      // search_wcag call.
      const wcagRefs = dssToWcagMap.get(control.code) || []
      // Put the WCAG mapping at the top so it lands inside every snippet
      // window — wcagCorpus.js builds a ~500-char snippet centered on the
      // first query hit, and DSS bodies can exceed that.
      const wcagLine = wcagRefs.length
        ? `**Oobee maps this to:** ${wcagRefs.map((r) => `WCAG ${r}`).join(', ')}\n\n`
        : ''
      const text = `# DSS ${control.code}: ${control.title}\n\n${wcagLine}**Category:** ${catData.title} (${catData.code})\n\n${control.body}`
      chunks.push({
        code: control.code,
        title: `DSS ${control.code}: ${control.title}`,
        sectionId: control.anchor || control.code.toLowerCase(),
        sectionTitle: control.title,
        categoryCode: catData.code,
        categoryTitle: catData.title,
        url: urlForDss(catData.code, control.anchor),
        text,
      })
    }
  }
  return { chunks, catalog }
}

// ---- Oobee DETAILS.md ingestion ----
//
// DETAILS.md contains: (a) definitions of Must Fix / Good to Fix / Manual
// Review Required, (b) the master WCAG↔DSS mapping table, (c) per-
// conformance-level rule tables (rule id → WCAG SC → DSS clause), (d) a
// "Best Practice" rule list, and (e) an explainer for the AAA readability
// grading rule (`oobee-grading-text-contents`). We split by top-level `##`
// heading so each section becomes one chunk — small enough to survive
// Vectra's 512-token cap, large enough that a query hits the whole table.

function parseDssToWcagMap(md) {
  // Master mapping table row shape:
  //   | WCAG 1.1.1  | WP-1           | A     | Yes ...
  // A DSS code of "—" means "no DSS mapping".
  const map = new Map()
  for (const row of parseCoverageTable(md)) {
    if (!row.dss) continue
    if (!map.has(row.dss)) map.set(row.dss, [])
    if (!map.get(row.dss).includes(row.wcag)) map.get(row.dss).push(row.wcag)
  }
  return map
}

// Master mapping table columns:
//   WCAG SC | DSS Clause | Level | Must Fix | Good to Fix | Manual Review
// Returns one entry per WCAG-anchored row (the Best Practice row is skipped —
// it aggregates many rules, not a single mapping). Emitted into
// oobeeDetails.coverage so list_corpus_metadata can answer "list every
// clause Oobee detects mapped to DSS" deterministically instead of via
// BM25 top-K over the ingested table chunk.
function parseCoverageTable(md) {
  const rowRe = /\|\s*WCAG\s+([\d.]+)\s*\|\s*([A-Z]{2}-\d+|—)\s*\|\s*(A{1,3})\s*\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|/g
  const rows = []
  let m
  while ((m = rowRe.exec(md)) !== null) {
    const hasYes = (cell) => /Yes/.test(cell)
    const mustFix = hasYes(m[4])
    const goodToFix = hasYes(m[5])
    const needsReview = hasYes(m[6])
    rows.push({
      wcag: m[1],
      dss: m[2] === '—' ? null : m[2],
      level: m[3],
      mustFix,
      goodToFix,
      needsReview,
      // A single category label so consumers don't have to inspect three
      // booleans. Priority matches the DETAILS.md legend (Manual Review is
      // "exclusive to" — takes precedence over Must Fix / Good to Fix).
      category: needsReview
        ? 'needsReview'
        : mustFix
        ? 'mustFix'
        : goodToFix
        ? 'goodToFix'
        : null,
    })
  }
  return rows
}

function chunkDetailsMd(md) {
  // Split at `## ` headings. Keep the heading with its body.
  const lines = md.split('\n')
  const sections = []
  let current = null
  for (const line of lines) {
    if (/^##\s+\S/.test(line) && !/^###/.test(line)) {
      if (current) sections.push(current)
      const heading = line.replace(/^##\s+/, '').trim()
      const slug = heading
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      current = { heading, slug, lines: [line] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) sections.push(current)
  return sections
    .map((s) => ({
      slug: s.slug,
      heading: s.heading,
      text: s.lines.join('\n').trim(),
    }))
    .filter((s) => s.text.length > 60)
}

async function collectOobeeDetailsChunks() {
  if (!fs.existsSync(DETAILS_MD_PATH)) {
    console.warn(
      `[wcag-index] no oobee DETAILS.md at ${DETAILS_MD_PATH} — skipping. ` +
        'ensure-wcag-index.js fetches this before invoking the builder.'
    )
    return { chunks: [], dssToWcag: new Map(), coverage: [] }
  }
  const md = await fsp.readFile(DETAILS_MD_PATH, 'utf8')
  const dssToWcag = parseDssToWcagMap(md)
  const coverage = parseCoverageTable(md)
  if (coverage.length === 0) {
    console.warn(
      '[wcag-index] DETAILS.md master mapping table returned 0 rows — ' +
        'the upstream table shape may have changed. list_corpus_metadata ' +
        'will not be able to answer "list every clause Oobee detects" questions.'
    )
  }
  const chunks = chunkDetailsMd(md).map((s) => ({
    slug: s.slug,
    title: 'Oobee — Scan Issue Details',
    sectionTitle: s.heading,
    text: `# Oobee — ${s.heading}\n\n${s.text.replace(/^##\s+.+\n/, '').trim()}`,
    url: `${DETAILS_MD_URL}#${s.slug}`,
  }))
  return { chunks, dssToWcag, coverage }
}

// Collected in-memory during the page-walk pass; consumed by the batched
// embed+write pass in main(). Streaming per-chunk embeddings via ONNX one at
// a time is ~10x slower than batching, so we defer disk writes until we can
// call the embedder with an array of texts.
const CHUNK_BUFFER = []

function collectChunk(metadata, text) {
  // Concatenate metadata surfaces into the embedding input — retrieval
  // quality is materially better when the title/sectionTitle appears in
  // the vector, since natural-language queries often paraphrase them.
  const embedText = [metadata.title || '', metadata.sectionTitle || '', text]
    .filter(Boolean)
    .join('\n\n')
  CHUNK_BUFFER.push({ metadata, text, embedText })
}

async function writeAllChunks() {
  const { embedBatch } = require('../public/electron/embeddings.js')
  const BATCH = 32
  const total = CHUNK_BUFFER.length
  console.log(
    `[wcag-index] embedding ${total} chunks (Xenova/all-MiniLM-L6-v2, batch=${BATCH}) …`
  )
  let done = 0
  const t0 = Date.now()
  for (let i = 0; i < total; i += BATCH) {
    const batch = CHUNK_BUFFER.slice(i, i + BATCH)
    const vectors = await embedBatch(batch.map((c) => c.embedText))
    for (let j = 0; j < batch.length; j++) {
      const { metadata, text } = batch[j]
      const vec = vectors[j]
      const id = crypto.randomUUID()
      await fsp.writeFile(
        path.join(OUT_DIR, `${id}.pb`),
        JSON.stringify(metadata),
        'utf8'
      )
      await fsp.writeFile(path.join(OUT_DIR, `${id}.txt`), text, 'utf8')
      // Raw little-endian float32 blob — 384 * 4 = 1536 bytes per file.
      await fsp.writeFile(
        path.join(OUT_DIR, `${id}.vec`),
        Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
      )
    }
    done += batch.length
    if (done % 320 === 0 || done === total) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(
        `[wcag-index] embedded ${done}/${total} chunks (${elapsed}s elapsed)`
      )
    }
  }
}

async function main() {
  // --meta-only regenerates `_meta.json` (used by the list_corpus_metadata
  // tool) without touching the embedded `.pb`/`.txt` chunk store. Useful
  // after a DSS-catalog refresh or a metadata-shape bump so you don't pay
  // the embedding rebuild cost.
  const metaOnly = process.argv.slice(2).includes('--meta-only')

  verifyCheckout()

  if (!metaOnly) {
    if (fs.existsSync(OUT_DIR)) {
      console.log(`[wcag-index] wiping existing ${OUT_DIR}`)
      await fsp.rm(OUT_DIR, { recursive: true, force: true })
    }
    await fsp.mkdir(OUT_DIR, { recursive: true })
  } else {
    if (!fs.existsSync(OUT_DIR)) {
      throw new Error(
        `--meta-only requires ${OUT_DIR} to already exist. Run without --meta-only first.`
      )
    }
    console.log(`[wcag-index] --meta-only: leaving existing chunks in ${OUT_DIR} intact`)
  }

  const understanding = await collectUnderstandingPages()
  const techniques = await collectTechniquePages()
  const oobeeDetails = await collectOobeeDetailsChunks()
  const { chunks: dssControls, catalog: dssCatalog } = await collectDssControls(
    oobeeDetails.dssToWcag
  )
  console.log(
    `[wcag-index] sources — understanding: ${understanding.length}, ` +
      `techniques+failures: ${techniques.length}, ` +
      `DSS controls: ${dssControls.length}, ` +
      `oobee DETAILS.md sections: ${oobeeDetails.chunks.length}`
  )

  let chunkCount = 0
  let pageCount = 0

  const processPage = async (page) => {
    const html = await fsp.readFile(page.filePath, 'utf8')
    const $ = cheerio.load(html)
    const { chunks, title } = chunkPage($, page.filePath, page)
    if (!chunks.length) return

    for (const chunk of chunks) {
      const metadata = {
        docType: page.docType,
        title: title || '',
        sectionId: chunk.sectionId,
        sectionTitle: chunk.sectionTitle,
        url: page.url,
      }
      if (page.docType === 'understanding') {
        metadata.slug = page.slug
        metadata.wcagVersion = page.wcagVersion
      } else {
        metadata.techId = page.techId
        metadata.category = page.category
      }
      collectChunk(metadata, chunk.text)
      chunkCount++
    }
    pageCount++
    if (pageCount % 25 === 0) {
      console.log(`[wcag-index] indexed ${pageCount} pages, ${chunkCount} chunks…`)
    }
  }

  if (!metaOnly) {
    for (const page of understanding) await processPage(page)
    for (const page of techniques) await processPage(page)
  }

  for (const control of metaOnly ? [] : dssControls) {
    const metadata = {
      docType: 'dss',
      // techId is the wcagCorpus.js title-boost field. Setting it to the DSS
      // code makes "WP-1"/"WO-4" queries land here.
      techId: control.code,
      title: control.title,
      sectionId: control.sectionId,
      sectionTitle: control.sectionTitle,
      category: control.categoryCode,
      categoryTitle: control.categoryTitle,
      url: control.url,
    }
    collectChunk(metadata, control.text)
    chunkCount++
    pageCount++
  }

  for (const section of metaOnly ? [] : oobeeDetails.chunks) {
    const metadata = {
      docType: 'oobee-details',
      title: section.title,
      sectionId: section.slug,
      sectionTitle: section.sectionTitle,
      url: section.url,
    }
    collectChunk(metadata, section.text)
    chunkCount++
    pageCount++
  }

  // Batched embed + disk flush. Skipped in --meta-only since CHUNK_BUFFER
  // is empty on that path and the existing .pb/.txt/.vec files stay intact.
  if (!metaOnly && CHUNK_BUFFER.length > 0) {
    await writeAllChunks()
  }

  // Aggregate counts for the `list_corpus_metadata` tool. BM25 returns
  // top-K matches; this file answers "how many X exist" without ever
  // touching the index.
  const wcagUnderstandingByVersion = {}
  for (const p of understanding) {
    wcagUnderstandingByVersion[p.wcagVersion] =
      (wcagUnderstandingByVersion[p.wcagVersion] || 0) + 1
  }
  const wcagTechniquesByCategory = {}
  let wcagFailures = 0
  for (const p of techniques) {
    if (p.docType === 'failure') wcagFailures++
    wcagTechniquesByCategory[p.category] =
      (wcagTechniquesByCategory[p.category] || 0) + 1
  }
  const meta = {
    builtAt: new Date().toISOString(),
    wcag: {
      sourceTag: EXPECTED_TAG,
      total_understanding_pages: understanding.length,
      understanding_by_version: wcagUnderstandingByVersion,
      total_technique_pages: techniques.length,
      techniques_by_category: wcagTechniquesByCategory,
      failure_pages: wcagFailures,
    },
    dss: dssCatalog
      ? {
          fetchedAt: dssCatalog.fetchedAt,
          total_categories: dssCatalog.categories.length,
          total_controls: dssCatalog.categories.reduce(
            (n, c) => n + c.controlCount,
            0
          ),
          categories: dssCatalog.categories,
        }
      : null,
    oobeeDetails: {
      sourceUrl: DETAILS_MD_URL,
      total_sections: oobeeDetails.chunks.length,
      sections: oobeeDetails.chunks.map((s) => ({
        heading: s.sectionTitle,
        slug: s.slug,
        url: s.url,
      })),
      // Full parse of the DETAILS.md "Breakdown of WCAG Clauses and Best
      // Practice" master table — one entry per WCAG SC Oobee covers, with
      // its DSS clause (or null for AAA rules with no DSS mapping), WCAG
      // level, and Oobee category. `list_corpus_metadata({source:
      // 'oobee-details'})` returns this so LLMs can answer "list every
      // clause Oobee detects mapped to DSS" in one deterministic tool call
      // instead of hammering search_wcag with BM25 top-K queries.
      total_coverage_rows: oobeeDetails.coverage.length,
      coverage_totals_by_level: oobeeDetails.coverage.reduce((acc, r) => {
        acc[r.level] = (acc[r.level] || 0) + 1
        return acc
      }, {}),
      coverage_totals_by_category: oobeeDetails.coverage.reduce((acc, r) => {
        if (r.category) acc[r.category] = (acc[r.category] || 0) + 1
        return acc
      }, {}),
      coverage: oobeeDetails.coverage,
    },
  }
  await fsp.writeFile(
    path.join(OUT_DIR, '_meta.json'),
    JSON.stringify(meta, null, 2),
    'utf8'
  )

  if (metaOnly) {
    console.log(
      `[wcag-index] --meta-only: wrote _meta.json only (${OUT_DIR}); chunks untouched.`
    )
  } else {
    console.log(
      `[wcag-index] DONE — ${pageCount} pages, ${chunkCount} chunks written to ${OUT_DIR}`
    )
    console.log(`[wcag-index] wrote _meta.json (aggregate counts for list_corpus_metadata)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
