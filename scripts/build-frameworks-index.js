#!/usr/bin/env node
/*
 * Build a BM25 + vector search index for language/framework docs (React,
 * Vue, Angular, MDN JavaScript, TypeScript).
 *
 * TWO MODES — selected by environment variable:
 *
 * ── Precomputed mode (default, fast) ────────────────────────────────────────
 *   Set FRAMEWORKS_INDEX_ZIP (path to extracted docs-index.zip contents) or
 *   FRAMEWORKS_PRECOMPUTED_DIR (path to a directory containing chunks.jsonl,
 *   vectors.bin and meta.json).  ensure-frameworks-index.js sets
 *   FRAMEWORKS_PRECOMPUTED_DIR after downloading and unzipping
 *   docs-index.zip from the oobee-ai-rag-index `latest-precompute` release.
 *
 *   In this mode the script reads precomputed chunks + 384-dim MiniLM
 *   embeddings directly — no clone, no chunking, no embedding pass —
 *   and writes the .pb/.txt/.vec triples that languageFrameworksCorpus.js
 *   expects.
 *
 * ── Clone+embed mode (fallback) ─────────────────────────────────────────────
 *   When FRAMEWORKS_PRECOMPUTED_DIR is absent the script falls back to the
 *   original behaviour: read a local checkout of oobee-ai-rag-index
 *   (FRAMEWORKS_SRC_DIR, default .cache/frameworks-src/), split each
 *   markdown file by ## heading, embed each chunk with MiniLM, and write
 *   the triples.  ensure-frameworks-index.js still performs this fallback
 *   unless --no-clone-fallback is passed.
 *
 * Output format (both modes):
 *   public/electron/frameworks-index/<uuid>.pb   — JSON metadata
 *   public/electron/frameworks-index/<uuid>.txt  — chunk body
 *   public/electron/frameworks-index/<uuid>.vec  — 384-dim fp32 embedding
 *   public/electron/frameworks-index/_meta.json  — aggregate counts
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const yaml = require('js-yaml')

// ─── Precomputed mode: directory that contains chunks.jsonl / vectors.bin /
//     meta.json (extracted from docs-index.zip).  ensure-frameworks-index.js
//     sets this after downloading + unzipping the release asset.
const PRECOMPUTED_DIR = process.env.FRAMEWORKS_PRECOMPUTED_DIR || null

// ─── Clone+embed mode (fallback) ────────────────────────────────────────────
const SRC_DIR =
  process.env.FRAMEWORKS_SRC_DIR ||
  path.join(__dirname, '..', '.cache', 'frameworks-src')
const OUT_DIR = path.join(__dirname, '..', 'public', 'electron', 'frameworks-index')
// WCAG/DSS/oobee-details chunks from the precomputed zip land here so
// wcagCorpus.js can find them without a separate ensure-wcag-index.js run.
const WCAG_OUT_DIR = path.join(__dirname, '..', 'public', 'electron', 'wcag-index')
const CONFIG_PATH = PRECOMPUTED_DIR
  ? path.join(PRECOMPUTED_DIR, 'config.yaml')
  : path.join(SRC_DIR, 'config.yaml')

// docs/<bucket>/<family>/... — where each family lives in the checkout.
// Matches the `output_dir` layout produced by oobee-ai-rag-index's
// scrape.py (react/vue/angular default to docs/frameworks; javascript/
// typescript override to docs/languages).
const FAMILY_LAYOUT = [
  { family: 'react', docType: 'framework', bucket: 'frameworks', exts: ['.md', '.mdx'] },
  { family: 'vue', docType: 'framework', bucket: 'frameworks', exts: ['.md'] },
  { family: 'angular', docType: 'framework', bucket: 'frameworks', exts: ['.md'] },
  { family: 'javascript', docType: 'language', bucket: 'languages', exts: ['.md'] },
  { family: 'typescript', docType: 'language', bucket: 'languages', exts: ['.md'] },
  // MDN web reference. `html` rides as a language (HTML is a markup language;
  // fits alongside JS/TS in the languages aggregate). `accessibility` rides
  // as a framework (WAI-ARIA + a11y patterns feel more like a stack of
  // conventions than a language spec). Both scraped by oobee-ai-rag-index
  // into docs/web/{html,accessibility}/ — see its config.yaml `output_dir`.
  { family: 'html', docType: 'language', bucket: 'web', exts: ['.md'] },
  { family: 'accessibility', docType: 'framework', bucket: 'web', exts: ['.md'] },
]

const MIN_CHUNK_CHARS = 60
const MAX_CHUNK_CHARS = 8000

function log(...m) {
  console.log('[frameworks-index]', ...m)
}
function warn(...m) {
  console.warn('[frameworks-index]', ...m)
}

function loadSourcesConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    // config.yaml is optional in precomputed mode — it is bundled inside
    // docs-index.zip since the oobee-ai-rag-index release workflow was updated
    // to copy it there, but older releases won't have it.  Return null so
    // callers can skip URL generation gracefully rather than hard-failing.
    if (PRECOMPUTED_DIR) {
      warn(`config.yaml not found at ${CONFIG_PATH} — upstream URLs will be omitted`)
      return null
    }
    throw new Error(
      `oobee-ai-rag-index config.yaml missing at ${CONFIG_PATH}. ` +
        'Run scripts/ensure-frameworks-index.js first — it clones the source repo.'
    )
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  const cfg = yaml.load(raw)
  if (!cfg || !cfg.sources) {
    throw new Error(`Unexpected config.yaml structure — no "sources" key`)
  }
  return cfg.sources
}

// Parse `https://github.com/OWNER/REPO.git|/` → { owner, repo }.
function parseGithubRepo(url) {
  const m = String(url).match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

function slugifyHeading(heading) {
  return String(heading)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function urlFor(sourceCfg, relativePath, sectionSlug) {
  const gh = parseGithubRepo(sourceCfg.repo)
  if (!gh) return ''
  const branch = sourceCfg.branch || 'main'
  const upstreamPath = `${sourceCfg.docs_path}/${relativePath}`.replace(/\\/g, '/')
  const base = `https://github.com/${gh.owner}/${gh.repo}/blob/${branch}/${upstreamPath}`
  return sectionSlug ? `${base}#${sectionSlug}` : base
}

// Walk a directory recursively and return every file whose extension is in
// `exts`. Skips hidden dirs (`.git`, `.github`, `.vitepress`, …).
async function walk(dir, exts) {
  const out = []
  async function visit(current) {
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(full)
      } else if (entry.isFile()) {
        if (exts.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
          out.push(full)
        }
      }
    }
  }
  await visit(dir)
  return out
}

// Extract the first level-1 heading (`# Foo`) from a markdown file. Falls
// back to the filename stem if no H1 is present. Skips MDX imports/JSX
// noise at the top of the file (react.dev pages sometimes lead with
// `import` statements before the H1).
function extractTitle(body, filename) {
  const lines = body.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) continue
    if (trimmed.startsWith('//') || trimmed.startsWith('{/*')) continue
    const m = trimmed.match(/^#\s+(.+)$/)
    if (m) return m[1].trim()
    // First non-heading, non-import content line — stop looking, use filename.
    break
  }
  return path.basename(filename).replace(/\.[^.]+$/, '')
}

// Split a markdown body into (heading, section-text) tuples on level-2
// (`## `) headings. Content before the first `## ` is emitted as a
// "preamble" section titled after the H1 (or the filename). Fenced code
// blocks are tracked so a `## Foo` inside a triple-backtick block doesn't
// falsely open a new section.
function chunkMarkdown(body, fallbackTitle) {
  const lines = body.split('\n')
  const sections = []
  let inFence = false
  let fenceMarker = ''
  let current = { heading: fallbackTitle, lines: [] }

  for (const line of lines) {
    const trimmedStart = line.replace(/^\s+/, '')
    if (inFence) {
      current.lines.push(line)
      if (trimmedStart.startsWith(fenceMarker)) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }
    const fenceMatch = trimmedStart.match(/^(```+|~~~+)/)
    if (fenceMatch) {
      inFence = true
      fenceMarker = fenceMatch[1]
      current.lines.push(line)
      continue
    }
    const h2 = line.match(/^##\s+(.+?)\s*#*\s*$/)
    if (h2 && !line.startsWith('###')) {
      if (current.lines.some((l) => l.trim())) {
        sections.push(current)
      }
      current = { heading: h2[1].trim(), lines: [] }
      continue
    }
    current.lines.push(line)
  }
  if (current.lines.some((l) => l.trim())) sections.push(current)

  // Emit chunks, splitting any section that ballooned past MAX_CHUNK_CHARS
  // into multiple pieces so a single very long section doesn't blow past
  // BM25's snippet window.
  const chunks = []
  for (const section of sections) {
    const raw = section.lines.join('\n').trim()
    if (raw.length < MIN_CHUNK_CHARS) continue
    if (raw.length <= MAX_CHUNK_CHARS) {
      chunks.push({ heading: section.heading, text: raw })
      continue
    }
    let remaining = raw
    let part = 1
    while (remaining.length > MAX_CHUNK_CHARS) {
      const cut = remaining.lastIndexOf('\n', MAX_CHUNK_CHARS)
      const splitAt = cut > MAX_CHUNK_CHARS / 2 ? cut : MAX_CHUNK_CHARS
      chunks.push({
        heading: `${section.heading} (part ${part})`,
        text: remaining.slice(0, splitAt).trim(),
      })
      remaining = remaining.slice(splitAt).trim()
      part += 1
    }
    if (remaining.length >= MIN_CHUNK_CHARS) {
      chunks.push({ heading: `${section.heading} (part ${part})`, text: remaining })
    }
  }
  return chunks
}

// Buffered until main() runs the batched embedder — see build-wcag-index.js
// for the same pattern and rationale (single-item embeds are ~10x slower).
const CHUNK_BUFFER = []

function collectChunk(metadata, text) {
  const embedText = [metadata.title || '', metadata.sectionTitle || '', text]
    .filter(Boolean)
    .join('\n\n')
  CHUNK_BUFFER.push({ metadata, text, embedText })
}

async function writeAllChunks() {
  const { embedBatch } = require('../public/electron/embeddings.js')
  const BATCH = 32
  const total = CHUNK_BUFFER.length
  log(
    `embedding ${total} chunks (Xenova/all-MiniLM-L6-v2, batch=${BATCH}) …`
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
      await fsp.writeFile(
        path.join(OUT_DIR, `${id}.vec`),
        Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
      )
    }
    done += batch.length
    if (done % 320 === 0 || done === total) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      log(`embedded ${done}/${total} chunks (${elapsed}s elapsed)`)
    }
  }
}

// ─── Namespace → {family, docType, bucket} lookup ───────────────────────────
// Matches build_local_index.py's walk_corpus() conventions:
//   framework:<name>  →  bucket=frameworks, docType=framework
//   lang:<name>       →  bucket=languages,  docType=language
//   web:<name>        →  bucket=web,         docType varies per FAMILY_LAYOUT
function resolveNamespace(namespace) {
  // Exact match from FAMILY_LAYOUT first (handles web/* correctly).
  for (const layout of FAMILY_LAYOUT) {
    const expectedNs = `${
      layout.docType === 'framework' ? 'framework' : layout.bucket === 'web' ? 'web' : 'lang'
    }:${layout.family}`
    if (namespace === expectedNs) return layout
  }
  // Generic fallback so new families added to oobee-ai-rag-index don't crash.
  const [prefix, name] = namespace.split(':')
  if (!name) return null
  if (prefix === 'framework') return { family: name, docType: 'framework', bucket: 'frameworks' }
  if (prefix === 'lang') return { family: name, docType: 'language', bucket: 'languages' }
  if (prefix === 'web') return { family: name, docType: 'framework', bucket: 'web' }
  return null
}

async function processFile({ filePath, family, docType, bucket, sourceCfg, familyRoot }) {
  const body = await fsp.readFile(filePath, 'utf8')
  const title = extractTitle(body, filePath)
  const relativeToFamily = path.relative(familyRoot, filePath).replace(/\\/g, '/')
  const chunks = chunkMarkdown(body, title)

  let written = 0
  for (const chunk of chunks) {
    const slug = slugifyHeading(chunk.heading)
    const url = urlFor(sourceCfg, relativeToFamily, slug)
    const meta = {
      title,
      sectionTitle: chunk.heading,
      docType,
      family,
      bucket,
      path: `docs/${bucket}/${family}/${relativeToFamily}`,
      url,
    }
    collectChunk(meta, chunk.text)
    written += 1
  }
  return written
}

// ─── Precomputed mode main ───────────────────────────────────────────────────
async function mainPrecomputed() {
  const chunksPath = path.join(PRECOMPUTED_DIR, 'chunks.jsonl')
  const vectorsPath = path.join(PRECOMPUTED_DIR, 'vectors.bin')
  const metaPath = path.join(PRECOMPUTED_DIR, 'meta.json')

  for (const [label, p] of [
    ['chunks.jsonl', chunksPath],
    ['vectors.bin', vectorsPath],
    ['meta.json', metaPath],
  ]) {
    if (!fs.existsSync(p)) {
      throw new Error(`${label} missing at ${p}. Re-download docs-index.zip.`)
    }
  }

  const indexMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  const DIMS = indexMeta.dims || 384
  const expectedCount = indexMeta.count
  log(`precomputed mode: ${expectedCount} chunks, ${DIMS} dims`)

  // Optional config.yaml for upstream URL generation.
  const sources = loadSourcesConfig()

  const chunkLines = fs.readFileSync(chunksPath, 'utf8').split('\n').filter(Boolean)
  if (chunkLines.length !== expectedCount) {
    warn(`chunks.jsonl has ${chunkLines.length} lines but meta.json says ${expectedCount}`)
  }
  const actualCount = chunkLines.length
  const expectedBytes = actualCount * DIMS * 4
  const actualBytes = fs.statSync(vectorsPath).size
  if (actualBytes !== expectedBytes) {
    throw new Error(
      `vectors.bin size mismatch: ${actualBytes} bytes but expected ${expectedBytes} ` +
        `(${actualCount} x ${DIMS} dims x 4 bytes)`
    )
  }

  // Wipe + recreate both output dirs so we start clean.
  for (const dir of [OUT_DIR, WCAG_OUT_DIR]) {
    if (fs.existsSync(dir)) {
      log(`wiping existing ${dir}`)
      await fsp.rm(dir, { recursive: true, force: true })
    }
    await fsp.mkdir(dir, { recursive: true })
  }

  const vectorsBuf = fs.readFileSync(vectorsPath)
  const bytesPerVec = DIMS * 4
  const perFamilyMap = new Map()
  let writtenFrameworks = 0
  let writtenWcag = 0

  for (let i = 0; i < actualCount; i++) {
    let record
    try { record = JSON.parse(chunkLines[i]) } catch (e) {
      warn(`failed to parse chunks.jsonl line ${i + 1}: ${e.message} — skipping`)
      continue
    }
    const { namespace, sourceFile, heading, text } = record
    if (!text || text.trim().length < MIN_CHUNK_CHARS) continue

    const vecSlice = vectorsBuf.slice(i * bytesPerVec, i * bytesPerVec + bytesPerVec)
    const uuid = crypto.randomUUID()

    // ── WCAG / DSS / oobee-details chunks → wcag-index/ ──────────────────
    if (namespace && namespace.startsWith('wcag:')) {
      const chunkMeta = record.metadata || {}
      const pb = {
        title:         chunkMeta.title         || heading || sourceFile || namespace,
        sectionTitle:  chunkMeta.sectionTitle  || heading || '',
        url:           chunkMeta.url           || '',
        docType:       chunkMeta.docType       || namespace.replace('wcag:', ''),
        techId:        chunkMeta.techId        || '',
        wcagVersion:   chunkMeta.wcagVersion   || '',
        sectionId:     chunkMeta.sectionId     || '',
        category:      chunkMeta.category      || '',
        categoryTitle: chunkMeta.categoryTitle || '',
        namespace,
      }
      await fsp.writeFile(path.join(WCAG_OUT_DIR, `${uuid}.pb`), JSON.stringify(pb), 'utf8')
      await fsp.writeFile(path.join(WCAG_OUT_DIR, `${uuid}.txt`), text, 'utf8')
      await fsp.writeFile(path.join(WCAG_OUT_DIR, `${uuid}.vec`), vecSlice)
      writtenWcag += 1
      if (writtenWcag % 500 === 0) log(`wcag-index: written ${writtenWcag} chunks ...`)
      continue
    }

    // ── Framework / language / web chunks → frameworks-index/ ────────────
    const layout = resolveNamespace(namespace)
    if (!layout) { warn(`unknown namespace "${namespace}" on chunk ${i + 1} — skipping`); continue }
    let url = ''
    if (sources && sources[layout.family]) {
      url = urlFor(sources[layout.family], sourceFile || '', slugifyHeading(heading || ''))
    }
    const title = heading || path.basename(sourceFile || '', path.extname(sourceFile || ''))
    const meta = {
      title, sectionTitle: heading || title, docType: layout.docType,
      family: layout.family, bucket: layout.bucket,
      path: `docs/${layout.bucket}/${layout.family}/${sourceFile || ''}`, url,
    }
    await fsp.writeFile(path.join(OUT_DIR, `${uuid}.pb`), JSON.stringify(meta), 'utf8')
    await fsp.writeFile(path.join(OUT_DIR, `${uuid}.txt`), text, 'utf8')
    await fsp.writeFile(path.join(OUT_DIR, `${uuid}.vec`), vecSlice)
    if (!perFamilyMap.has(layout.family)) perFamilyMap.set(layout.family, { files: new Set(), chunks: 0 })
    const fStat = perFamilyMap.get(layout.family)
    if (sourceFile) fStat.files.add(sourceFile)
    fStat.chunks += 1; writtenFrameworks += 1
    if (writtenFrameworks % 500 === 0) log(`frameworks-index: written ${writtenFrameworks} chunks ...`)
  }

  log(`frameworks-index: ${writtenFrameworks} chunks written`)
  log(`wcag-index: ${writtenWcag} chunks written`)

  // ── frameworks-index/_meta.json ──────────────────────────────────────────
  const perFamily = [...perFamilyMap.entries()].map(([family, s]) => ({ family, files: s.files.size, chunks: s.chunks }))
  const fwFams = perFamily.filter((f) => { const l = FAMILY_LAYOUT.find((x) => x.family === f.family); return l && l.docType === 'framework' })
  const langFams = perFamily.filter((f) => { const l = FAMILY_LAYOUT.find((x) => x.family === f.family); return l && l.docType === 'language' })
  const sourceTag = process.env.FRAMEWORKS_SRC_TAG || indexMeta.commitSha || null
  const outputMeta = {
    builtAt: new Date().toISOString(), mode: 'precomputed',
    sourceRepo: 'https://github.com/GovTechSG/oobee-ai-rag-index', sourceTag,
    precomputedModel: indexMeta.model || 'sentence-transformers/all-MiniLM-L6-v2',
    precomputedDims: DIMS, precomputedGeneratedAt: indexMeta.generatedAt || null,
    families: perFamily.map((f) => {
      const l = FAMILY_LAYOUT.find((x) => x.family === f.family)
      const src = (sources && sources[f.family]) || {}
      return { family: f.family, docType: l ? l.docType : null, bucket: l ? l.bucket : null,
        upstreamRepo: src.repo || null, upstreamDocsPath: src.docs_path || null, files: f.files, chunks: f.chunks }
    }),
    frameworks: { total_families: fwFams.length, total_files: fwFams.reduce((n, f) => n + f.files, 0), total_chunks: fwFams.reduce((n, f) => n + f.chunks, 0) },
    languages: { total_families: langFams.length, total_files: langFams.reduce((n, f) => n + f.files, 0), total_chunks: langFams.reduce((n, f) => n + f.chunks, 0) },
    total_files: perFamily.reduce((n, f) => n + f.files, 0), total_chunks: writtenFrameworks,
  }
  await fsp.writeFile(path.join(OUT_DIR, '_meta.json'), JSON.stringify(outputMeta, null, 2), 'utf8')

  // ── wcag-index/_meta.json ────────────────────────────────────────────────
  // Shape mirrors build-wcag-index.js output: top-level wcag/dss/oobeeDetails
  // keys are read directly by list_corpus_metadata in llmAnalysis.js.
  const wcagOutputMeta = {
    builtAt: indexMeta.builtAt || new Date().toISOString(),
    mode: 'precomputed',
    sourceRepo: 'https://github.com/GovTechSG/oobee-ai-rag-index',
    sourceTag,
    precomputedModel: indexMeta.model || 'sentence-transformers/all-MiniLM-L6-v2',
    total_chunks: writtenWcag,
    wcag:         indexMeta.wcag         || null,
    dss:          indexMeta.dss          || null,
    oobeeDetails: indexMeta.oobeeDetails || null,
  }
  await fsp.writeFile(path.join(WCAG_OUT_DIR, '_meta.json'), JSON.stringify(wcagOutputMeta, null, 2), 'utf8')

  log(`DONE (precomputed) — frameworks-index: ${writtenFrameworks}, wcag-index: ${writtenWcag}`)
  if (writtenFrameworks === 0) throw new Error('No framework chunks written — check PRECOMPUTED_DIR structure.')
  if (writtenWcag === 0) warn('No wcag:* chunks found in precomputed zip — wcag-index will be empty.')
}

// ─── Clone+embed mode main ───────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(
      `Source dir missing: ${SRC_DIR}. Run scripts/ensure-frameworks-index.js first.`
    )
  }
  const sources = loadSourcesConfig()

  if (fs.existsSync(OUT_DIR)) {
    log(`wiping existing ${OUT_DIR}`)
    await fsp.rm(OUT_DIR, { recursive: true, force: true })
  }
  await fsp.mkdir(OUT_DIR, { recursive: true })

  let totalFiles = 0
  let totalChunks = 0
  const perFamily = []

  for (const layout of FAMILY_LAYOUT) {
    const sourceCfg = sources[layout.family]
    if (!sourceCfg) {
      warn(`config.yaml has no "sources.${layout.family}" — skipping`)
      continue
    }
    const familyRoot = path.join(SRC_DIR, 'docs', layout.bucket, layout.family)
    if (!fs.existsSync(familyRoot)) {
      warn(`family root missing at ${familyRoot} — skipping`)
      continue
    }
    const files = await walk(familyRoot, layout.exts)
    if (files.length === 0) {
      warn(`no docs found under ${familyRoot}`)
      continue
    }
    let familyChunks = 0
    for (const filePath of files) {
      try {
        const n = await processFile({
          filePath,
          family: layout.family,
          docType: layout.docType,
          bucket: layout.bucket,
          sourceCfg,
          familyRoot,
        })
        familyChunks += n
      } catch (e) {
        warn(`failed to process ${filePath}: ${e.message}`)
      }
    }
    perFamily.push({ family: layout.family, files: files.length, chunks: familyChunks })
    totalFiles += files.length
    totalChunks += familyChunks
    log(`${layout.family}: ${files.length} files → ${familyChunks} chunks`)
  }

  // Batched embed + disk flush across all families at once — a single
  // pipeline warm-up amortized across ~5,600 chunks beats warming per family.
  if (CHUNK_BUFFER.length > 0) {
    await writeAllChunks()
  }

  // Aggregate counts for the `list_corpus_metadata` tool.
  const frameworkFamilies = perFamily.filter((f) => {
    const layout = FAMILY_LAYOUT.find((l) => l.family === f.family)
    return layout && layout.docType === 'framework'
  })
  const languageFamilies = perFamily.filter((f) => {
    const layout = FAMILY_LAYOUT.find((l) => l.family === f.family)
    return layout && layout.docType === 'language'
  })
  // Prefer the pin passed by ensure-frameworks-index.js. Fall back to
  // `git describe` when the env var is missing (e.g. running this script
  // directly against a hand-checked-out source tree). Describe alone is
  // unreliable when multiple tags point at the same commit — it can pick
  // a moving tag (`latest-sync`) instead of the pinned tag.
  let sourceTag = process.env.FRAMEWORKS_SRC_TAG || null
  if (!sourceTag) {
    try {
      sourceTag = execSync('git describe --tags --always', { cwd: SRC_DIR })
        .toString()
        .trim()
    } catch (e) {
      // SRC_DIR may not be a git checkout (e.g. tarball extraction) — skip.
    }
  }
  const meta = {
    builtAt: new Date().toISOString(),
    sourceRepo: 'https://github.com/GovTechSG/oobee-ai-rag-index',
    sourceTag,
    families: perFamily.map((f) => {
      const layout = FAMILY_LAYOUT.find((l) => l.family === f.family)
      const src = sources[f.family] || {}
      return {
        family: f.family,
        docType: layout ? layout.docType : null,
        bucket: layout ? layout.bucket : null,
        upstreamRepo: src.repo || null,
        upstreamDocsPath: src.docs_path || null,
        files: f.files,
        chunks: f.chunks,
      }
    }),
    frameworks: {
      total_families: frameworkFamilies.length,
      total_files: frameworkFamilies.reduce((n, f) => n + f.files, 0),
      total_chunks: frameworkFamilies.reduce((n, f) => n + f.chunks, 0),
    },
    languages: {
      total_families: languageFamilies.length,
      total_files: languageFamilies.reduce((n, f) => n + f.files, 0),
      total_chunks: languageFamilies.reduce((n, f) => n + f.chunks, 0),
    },
    total_files: totalFiles,
    total_chunks: totalChunks,
  }
  await fsp.writeFile(
    path.join(OUT_DIR, '_meta.json'),
    JSON.stringify(meta, null, 2),
    'utf8'
  )

  log(`DONE — ${totalFiles} files, ${totalChunks} chunks written to ${OUT_DIR}`)
  log(`wrote _meta.json (aggregate counts for list_corpus_metadata)`)
  if (totalChunks === 0) {
    throw new Error('No chunks written — check SRC_DIR structure and config.yaml.')
  }
}

// ─── Entry point — route to the right mode ───────────────────────────────────
;(PRECOMPUTED_DIR ? mainPrecomputed() : main()).catch((e) => {
  console.error('[frameworks-index] FATAL:', e)
  process.exit(1)
})
