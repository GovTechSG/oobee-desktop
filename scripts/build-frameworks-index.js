#!/usr/bin/env node
/*
 * Build a BM25 search index for language/framework docs (React, Vue, Angular,
 * MDN JavaScript, TypeScript).
 *
 * Reads the docs tree of a local checkout of
 * https://github.com/GovTechSG/oobee-ai-rag-index (pinned at tag
 * synced/2026-08-22 by ensure-frameworks-index.js), splits each markdown file
 * by `##` heading, and writes `<uuid>.pb` (JSON metadata) + `<uuid>.txt`
 * (chunk body) pairs to `public/electron/frameworks-index/` — the same
 * on-disk layout that `wcagCorpus.js` uses so `languageFrameworksCorpus.js`
 * can BM25-search it without embedding.
 *
 * Usage:
 *   FRAMEWORKS_SRC_DIR=/path/to/oobee-ai-rag-index node scripts/build-frameworks-index.js
 *
 * FRAMEWORKS_SRC_DIR defaults to .cache/frameworks-src/ (where
 * ensure-frameworks-index.js clones the repo).
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const yaml = require('js-yaml')

const SRC_DIR =
  process.env.FRAMEWORKS_SRC_DIR ||
  path.join(__dirname, '..', '.cache', 'frameworks-src')
const OUT_DIR = path.join(__dirname, '..', 'public', 'electron', 'frameworks-index')
const CONFIG_PATH = path.join(SRC_DIR, 'config.yaml')

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

async function processFile({ filePath, family, docType, bucket, sourceCfg, familyRoot }) {
  const body = await fsp.readFile(filePath, 'utf8')
  const title = extractTitle(body, filePath)
  const relativeToFamily = path.relative(familyRoot, filePath).replace(/\\/g, '/')
  const chunks = chunkMarkdown(body, title)

  const written = []
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
    const id = crypto.randomUUID()
    await fsp.writeFile(path.join(OUT_DIR, `${id}.pb`), JSON.stringify(meta), 'utf8')
    await fsp.writeFile(path.join(OUT_DIR, `${id}.txt`), chunk.text, 'utf8')
    written.push(id)
  }
  return written.length
}

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

  // Aggregate counts for the `list_corpus_metadata` tool.
  const frameworkFamilies = perFamily.filter((f) => {
    const layout = FAMILY_LAYOUT.find((l) => l.family === f.family)
    return layout && layout.docType === 'framework'
  })
  const languageFamilies = perFamily.filter((f) => {
    const layout = FAMILY_LAYOUT.find((l) => l.family === f.family)
    return layout && layout.docType === 'language'
  })
  let sourceTag = null
  try {
    sourceTag = execSync('git describe --tags --always', { cwd: SRC_DIR })
      .toString()
      .trim()
  } catch (e) {
    // SRC_DIR may not be a git checkout (e.g. tarball extraction) — skip.
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

main().catch((e) => {
  console.error('[frameworks-index] FATAL:', e)
  process.exit(1)
})
