// Lexical BM25 search over the on-disk WCAG corpus at
// `public/electron/wcag-index/`. The directory ships as pairs of
// `<uuid>.pb` (JSON metadata: title, url, docType, sectionTitle, techId,
// wcagVersion) and `<uuid>.txt` (the chunk body). Despite the extension,
// the `.pb` files are plain JSON — not protobuf.
//
// This module is consumed by the `search_wcag` tool exposed to both the
// Anthropic and Gemma tool-use loops in llmAnalysis.js. It intentionally
// avoids embeddings: the corpus is ~1,200 short chunks and queries from
// the model are keyword-heavy ("2.4.4", "focus visible", "G54"), so a
// BM25 index built in-process serves both backends without a cold-start
// embedding pass.

const fs = require('fs')
const path = require('path')

const K1 = 1.5
const B = 0.75
const TITLE_BOOST = 3
const SECTION_BOOST = 2
const SNIPPET_CHARS = 500

// Common English stopwords. Keep short — over-aggressive filtering hurts
// recall on multi-word queries like "target size minimum".
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to',
  'in', 'on', 'for', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it',
  'its', 'not', 'no', 'do', 'does', 'did', 'so', 'than', 'which', 'who',
  'what', 'when', 'where', 'why', 'how',
])

// Tokenize: lowercase, split on non-alphanumeric-or-dot boundaries, but
// KEEP dotted numeric identifiers ("2.4.4", "1.4.11") intact — those are
// WCAG SC numbers and the most important query terms. For a dotted
// numeric token we also emit each numeric piece separately so a chunk
// that mentions "2 4 4" in prose (rare but possible) still matches.
const DOTTED_NUM_RE = /^\d+(?:\.\d+)+$/
function tokenize(text) {
  if (!text) return []
  const out = []
  const raw = String(text)
    .toLowerCase()
    // Preserve dotted numerics. Split on runs of chars that are neither
    // [a-z0-9] nor '.', then post-filter tokens that are just '.'.
    .split(/[^a-z0-9.]+/g)
  for (let tok of raw) {
    if (!tok) continue
    // Strip stray leading/trailing dots ("2.4.4." → "2.4.4").
    tok = tok.replace(/^\.+|\.+$/g, '')
    if (!tok) continue
    if (STOPWORDS.has(tok)) continue
    if (DOTTED_NUM_RE.test(tok)) {
      out.push(tok)
      for (const piece of tok.split('.')) {
        if (piece) out.push(piece)
      }
      continue
    }
    // Drop tokens that still contain a dot but aren't dotted numerics
    // (e.g. abbreviations that survived split); split them further.
    if (tok.includes('.')) {
      for (const piece of tok.split('.')) {
        if (piece && !STOPWORDS.has(piece)) out.push(piece)
      }
      continue
    }
    out.push(tok)
  }
  return out
}

// Module-level cache keyed on the corpus directory. Survives across
// sessions in the same app run so a second user query doesn't re-read
// ~1,200 files from disk.
const corpusCache = new Map()

function readMetaSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (_) {
    return ''
  }
}

function loadCorpus(dir) {
  const cached = corpusCache.get(dir)
  if (cached) return cached

  if (!fs.existsSync(dir)) {
    throw new Error(`WCAG index directory not found: ${dir}`)
  }

  const entries = fs.readdirSync(dir)
  const ids = new Set()
  for (const e of entries) {
    if (e.endsWith('.pb')) ids.add(e.slice(0, -3))
  }

  const docs = []
  const df = new Map()
  let totalDl = 0

  for (const id of ids) {
    const meta = readMetaSafe(path.join(dir, `${id}.pb`))
    const body = readTextSafe(path.join(dir, `${id}.txt`))
    if (!meta || !body) continue

    const titleTokens = tokenize(meta.title)
    const sectionTokens = tokenize(meta.sectionTitle)
    // Technique/failure ids like "G54", "H37", "F89" are prime query terms.
    // Emit them as title-weighted tokens so a query naming the id hits
    // its chunk directly.
    const idTokens = meta.techId ? tokenize(meta.techId) : []
    const bodyTokens = tokenize(body)

    // Effective token stream with per-field boosting: each title token
    // counts TITLE_BOOST times toward its TF, section SECTION_BOOST, body 1.
    const tf = new Map()
    const bump = (toks, w) => {
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + w)
    }
    bump(bodyTokens, 1)
    bump(sectionTokens, SECTION_BOOST)
    bump(titleTokens, TITLE_BOOST)
    bump(idTokens, TITLE_BOOST)

    const dl =
      bodyTokens.length +
      sectionTokens.length * SECTION_BOOST +
      titleTokens.length * TITLE_BOOST +
      idTokens.length * TITLE_BOOST
    totalDl += dl

    for (const term of tf.keys()) {
      df.set(term, (df.get(term) || 0) + 1)
    }

    docs.push({ id, meta, body, tf, dl })
  }

  const N = docs.length
  const avgDl = N > 0 ? totalDl / N : 0

  const corpus = { docs, df, N, avgDl }
  corpusCache.set(dir, corpus)
  return corpus
}

function scoreDoc(doc, queryTerms, df, N, avgDl) {
  let score = 0
  for (const term of queryTerms) {
    const tf = doc.tf.get(term)
    if (!tf) continue
    const n = df.get(term) || 0
    // Standard BM25 IDF; clamp to 0 to avoid negatives when a term
    // appears in >half the corpus.
    const idf = Math.max(0, Math.log((N - n + 0.5) / (n + 0.5) + 1))
    const denom = tf + K1 * (1 - B + B * (doc.dl / (avgDl || 1)))
    score += idf * ((tf * (K1 + 1)) / denom)
  }
  return score
}

function buildSnippet(body, queryTerms) {
  if (!body) return ''
  const lower = body.toLowerCase()
  // Find the earliest position where any query term appears.
  let best = -1
  for (const t of queryTerms) {
    if (!t) continue
    const idx = lower.indexOf(t)
    if (idx >= 0 && (best === -1 || idx < best)) best = idx
  }
  if (best < 0) {
    return body.length > SNIPPET_CHARS ? body.slice(0, SNIPPET_CHARS) + '…' : body
  }
  const half = Math.floor(SNIPPET_CHARS / 2)
  const start = Math.max(0, best - half)
  const end = Math.min(body.length, start + SNIPPET_CHARS)
  let snip = body.slice(start, end)
  if (start > 0) snip = '…' + snip
  if (end < body.length) snip = snip + '…'
  return snip
}

function searchWcag({ dir, query, topK = 5 }) {
  const corpus = loadCorpus(dir)
  const rawTerms = tokenize(query)
  const queryTerms = Array.from(new Set(rawTerms))
  if (queryTerms.length === 0) {
    return { results: [], total_indexed: corpus.N, note: 'Query had no indexable tokens.' }
  }

  const scored = []
  for (const doc of corpus.docs) {
    const s = scoreDoc(doc, queryTerms, corpus.df, corpus.N, corpus.avgDl)
    if (s > 0) scored.push({ doc, score: s })
  }
  scored.sort((a, b) => b.score - a.score)

  const results = scored.slice(0, topK).map(({ doc, score }) => {
    const m = doc.meta
    const out = {
      id: doc.id,
      title: m.title,
      sectionTitle: m.sectionTitle,
      url: m.url,
      docType: m.docType,
      snippet: buildSnippet(doc.body, queryTerms),
      score: Number(score.toFixed(4)),
    }
    if (m.techId) out.techId = m.techId
    if (m.wcagVersion) out.wcagVersion = m.wcagVersion
    return out
  })

  return { results, total_indexed: corpus.N }
}

module.exports = { searchWcag, tokenize, loadCorpus }
