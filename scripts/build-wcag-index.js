#!/usr/bin/env node
/*
 * Build a Vectra vector index for WCAG 2.2 documentation.
 *
 * Reads Understanding docs + Techniques + Failures from a local checkout of
 * https://github.com/w3c/wcag pinned at tag `WCAG22-20241212`, chunks each
 * page by top-level <section id="…">, embeds each chunk with
 * Xenova/all-MiniLM-L6-v2 via @huggingface/transformers, and writes a Vectra
 * LocalDocumentIndex to `public/electron/wcag-index/` so it ships as part of
 * the packaged Electron app.
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
    return []
  }
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
  const chunks = []
  for (const cat of manifest.categories) {
    const catData = JSON.parse(
      await fsp.readFile(path.join(DSS_DIR, cat.file), 'utf8')
    )
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
  return chunks
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
  const rowRe = /\|\s*WCAG\s+([\d.]+)\s*\|\s*([A-Z]{2}-\d+|—)\s*\|/g
  let m
  while ((m = rowRe.exec(md)) !== null) {
    const wcag = m[1]
    const dss = m[2]
    if (dss === '—') continue
    if (!map.has(dss)) map.set(dss, [])
    if (!map.get(dss).includes(wcag)) map.get(dss).push(wcag)
  }
  return map
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
    return { chunks: [], dssToWcag: new Map() }
  }
  const md = await fsp.readFile(DETAILS_MD_PATH, 'utf8')
  const dssToWcag = parseDssToWcagMap(md)
  const chunks = chunkDetailsMd(md).map((s) => ({
    slug: s.slug,
    title: 'Oobee — Scan Issue Details',
    sectionTitle: s.heading,
    text: `# Oobee — ${s.heading}\n\n${s.text.replace(/^##\s+.+\n/, '').trim()}`,
    url: `${DETAILS_MD_URL}#${s.slug}`,
  }))
  return { chunks, dssToWcag }
}

async function loadEmbeddingsAndIndex() {
  // Lazy-load Vectra and TransformersEmbeddings so the require cost is only
  // paid inside this script, never at Electron main-process startup.
  const {
    LocalDocumentIndex,
    TransformersEmbeddings,
    ProtobufCodec,
  } = require('vectra')

  console.log('[wcag-index] loading Xenova/all-MiniLM-L6-v2 …')
  const embeddings = await TransformersEmbeddings.create({
    model: 'Xenova/all-MiniLM-L6-v2',
    device: 'cpu',
    normalize: true,
  })

  const index = new LocalDocumentIndex({
    folderPath: OUT_DIR,
    embeddings,
    tokenizer: embeddings.getTokenizer(),
    codec: new ProtobufCodec(),
    // Our page-level chunker already emits semantic units (~200-2000 chars).
    // Widen Vectra's sub-chunking so each section is 1 sub-chunk in the
    // common case, halving vector count and index size.
    chunkingConfig: {
      chunkSize: 512,
      chunkOverlap: 0,
    },
  })

  if (!(await index.isCatalogCreated())) {
    await index.createIndex({ version: 1 })
    console.log(`[wcag-index] created new index at ${OUT_DIR}`)
  } else {
    console.log(`[wcag-index] index already exists at ${OUT_DIR} — upserting`)
  }

  return { index }
}

async function main() {
  verifyCheckout()

  if (fs.existsSync(OUT_DIR)) {
    console.log(`[wcag-index] wiping existing ${OUT_DIR}`)
    await fsp.rm(OUT_DIR, { recursive: true, force: true })
  }
  await fsp.mkdir(OUT_DIR, { recursive: true })

  const understanding = await collectUnderstandingPages()
  const techniques = await collectTechniquePages()
  const oobeeDetails = await collectOobeeDetailsChunks()
  const dssControls = await collectDssControls(oobeeDetails.dssToWcag)
  console.log(
    `[wcag-index] sources — understanding: ${understanding.length}, ` +
      `techniques+failures: ${techniques.length}, ` +
      `DSS controls: ${dssControls.length}, ` +
      `oobee DETAILS.md sections: ${oobeeDetails.chunks.length}`
  )

  const { index } = await loadEmbeddingsAndIndex()

  let chunkCount = 0
  let pageCount = 0

  const processPage = async (page) => {
    const html = await fsp.readFile(page.filePath, 'utf8')
    const $ = cheerio.load(html)
    const { chunks, title } = chunkPage($, page.filePath, page)
    if (!chunks.length) return

    for (const chunk of chunks) {
      const uri =
        page.docType === 'understanding'
          ? `wcag://understanding/${page.slug}#${chunk.sectionId}`
          : `wcag://${page.docType}/${page.techId}#${chunk.sectionId}`
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
      await index.upsertDocument(uri, chunk.text, 'md', metadata)
      chunkCount++
    }
    pageCount++
    if (pageCount % 25 === 0) {
      console.log(`[wcag-index] indexed ${pageCount} pages, ${chunkCount} chunks…`)
    }
  }

  for (const page of understanding) await processPage(page)
  for (const page of techniques) await processPage(page)

  for (const control of dssControls) {
    const uri = `dss://${control.categoryCode}/${control.code.toLowerCase()}`
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
    await index.upsertDocument(uri, control.text, 'md', metadata)
    chunkCount++
    pageCount++
  }

  for (const section of oobeeDetails.chunks) {
    const uri = `oobee://details/${section.slug}`
    const metadata = {
      docType: 'oobee-details',
      title: section.title,
      sectionId: section.slug,
      sectionTitle: section.sectionTitle,
      url: section.url,
    }
    await index.upsertDocument(uri, section.text, 'md', metadata)
    chunkCount++
    pageCount++
  }

  console.log(
    `[wcag-index] DONE — ${pageCount} pages, ${chunkCount} chunks written to ${OUT_DIR}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
