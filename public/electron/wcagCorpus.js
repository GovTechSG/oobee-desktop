// Hybrid BM25 + vector search over the on-disk WCAG corpus at
// `public/electron/wcag-index/`. The directory ships as triples of
// `<uuid>.pb` (JSON metadata: title, url, docType, sectionTitle, techId,
// wcagVersion), `<uuid>.txt` (the chunk body), and `<uuid>.vec` (384-dim
// fp32 L2-normalized Xenova/all-MiniLM-L6-v2 embedding). Despite the
// extension, the `.pb` files are plain JSON — not protobuf.
//
// This module is consumed by the `search_wcag` tool exposed to both the
// Anthropic and Gemma tool-use loops in llmAnalysis.js. It combines two
// signals via Reciprocal Rank Fusion:
//   * BM25 with dot-preserving tokenizer — strong on keyword queries like
//     "2.4.4", "G54", "focus visible", "WP-1".
//   * Cosine similarity against MiniLM-L6-v2 embeddings — strong on
//     paraphrased/natural-language queries like "how do I make text
//     easier to read for cognitive disabilities".
// If the embedding model is unavailable at runtime (dev checkout, or
// startup before ONNX warm-up completes), the vector leg is skipped and
// pure BM25 results are returned — no crash, no user-visible failure.

const fs = require('fs')
const path = require('path')
const embeddings = require('./embeddings.js')

const K1 = 1.5
const B = 0.75
const TITLE_BOOST = 3
const SECTION_BOOST = 2
const SNIPPET_CHARS = 500
const EMBED_DIM = 384
const RRF_K = 60
const RRF_BM25_TOP = 50
const RRF_VEC_TOP = 50

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

// Read a raw fp32 vector file (produced by build-wcag-index.js). Returns
// null if missing or malformed — the doc still participates in BM25.
function readVecSafe(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    if (buf.length !== EMBED_DIM * 4) return null
    // Copy into a fresh Float32Array so alignment is guaranteed and the
    // backing Buffer can be GC'd once we're done.
    const out = new Float32Array(EMBED_DIM)
    for (let i = 0; i < EMBED_DIM; i++) {
      out[i] = buf.readFloatLE(i * 4)
    }
    return out
  } catch (_) {
    return null
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

  // Contiguous pool of doc vectors — allocated up front so the cosine
  // hot-path can walk one Float32Array instead of an array-of-arrays.
  // vecCount grows as we find `.vec` files; docs without a vector get
  // vecOffset = -1 and simply skip the vector ranking.
  let vecPool = new Float32Array(ids.size * EMBED_DIM)
  let vecCount = 0

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

    // Attach vector if a .vec file exists. Docs whose .vec is missing or
    // malformed keep vecOffset = -1 — they fall back to BM25-only for
    // that query but still contribute to the corpus otherwise.
    let vecOffset = -1
    const vec = readVecSafe(path.join(dir, `${id}.vec`))
    if (vec) {
      vecOffset = vecCount * EMBED_DIM
      vecPool.set(vec, vecOffset)
      vecCount += 1
    }

    docs.push({ id, meta, body, tf, dl, vecOffset })
  }

  const N = docs.length
  const avgDl = N > 0 ? totalDl / N : 0

  // Compact pool down to the actual number of vectors we found.
  if (vecCount * EMBED_DIM < vecPool.length) {
    vecPool = vecPool.slice(0, vecCount * EMBED_DIM)
  }

  const corpus = { docs, df, N, avgDl, vecPool, vecCount }
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

// Cosine similarity against the doc-vector pool. Both `q` and pooled
// vectors are L2-normalized, so cosine = dot product. Returns an array
// of { doc, score } sorted descending.
function scoreVec(docsSubset, corpus, q) {
  const pool = corpus.vecPool
  const out = []
  for (const doc of docsSubset) {
    if (doc.vecOffset < 0) continue
    let s = 0
    const off = doc.vecOffset
    // Unrolled by 4 — MiniLM-L6 is 384 dims, evenly divisible.
    for (let i = 0; i < EMBED_DIM; i += 4) {
      s +=
        q[i] * pool[off + i] +
        q[i + 1] * pool[off + i + 1] +
        q[i + 2] * pool[off + i + 2] +
        q[i + 3] * pool[off + i + 3]
    }
    out.push({ doc, score: s })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

// Reciprocal Rank Fusion — score(d) = Σ 1 / (k + rank_i(d)).
// Absent-from-a-ranking contributes 0 (missing rank => infinite => 0
// after 1/(k+inf)). Returns Map<docId, { doc, score, bm25Rank, vecRank,
// bm25Score, vecScore }>.
function fuseRRF(bm25Top, vecTop, k) {
  const merged = new Map()
  bm25Top.forEach(({ doc, score }, i) => {
    merged.set(doc.id, {
      doc,
      bm25Rank: i + 1,
      bm25Score: score,
      vecRank: null,
      vecScore: null,
      score: 1 / (k + i + 1),
    })
  })
  vecTop.forEach(({ doc, score }, i) => {
    const existing = merged.get(doc.id)
    if (existing) {
      existing.vecRank = i + 1
      existing.vecScore = score
      existing.score += 1 / (k + i + 1)
    } else {
      merged.set(doc.id, {
        doc,
        bm25Rank: null,
        bm25Score: null,
        vecRank: i + 1,
        vecScore: score,
        score: 1 / (k + i + 1),
      })
    }
  })
  return merged
}

async function searchWcag({ dir, query, topK = 5 }) {
  const corpus = loadCorpus(dir)
  const rawTerms = tokenize(query)
  const queryTerms = Array.from(new Set(rawTerms))
  if (queryTerms.length === 0) {
    return { results: [], total_indexed: corpus.N, note: 'Query had no indexable tokens.' }
  }

  // ---- BM25 ranking (always runs) ----
  const bm25Scored = []
  for (const doc of corpus.docs) {
    const s = scoreDoc(doc, queryTerms, corpus.df, corpus.N, corpus.avgDl)
    if (s > 0) bm25Scored.push({ doc, score: s })
  }
  bm25Scored.sort((a, b) => b.score - a.score)
  const bm25Top = bm25Scored.slice(0, RRF_BM25_TOP)

  // ---- Vector ranking (best-effort) ----
  let vecTop = []
  let mode = 'bm25'
  if (embeddings.isAvailable() && corpus.vecCount > 0) {
    try {
      const q = await embeddings.embed(query)
      vecTop = scoreVec(corpus.docs, corpus, q).slice(0, RRF_VEC_TOP)
      mode = 'hybrid'
    } catch (e) {
      console.warn(
        `[wcagCorpus] vector leg failed (${e.message}) — falling back to BM25-only`
      )
      vecTop = []
      mode = 'bm25'
    }
  }

  // ---- Fuse (or fall back) ----
  let ranked
  if (mode === 'hybrid') {
    const fused = fuseRRF(bm25Top, vecTop, RRF_K)
    ranked = Array.from(fused.values()).sort((a, b) => b.score - a.score)
  } else {
    ranked = bm25Top.map(({ doc, score }, i) => ({
      doc,
      score,
      bm25Rank: i + 1,
      bm25Score: score,
      vecRank: null,
      vecScore: null,
    }))
  }

  const results = ranked.slice(0, topK).map((r) => {
    const m = r.doc.meta
    const out = {
      id: r.doc.id,
      title: m.title,
      sectionTitle: m.sectionTitle,
      url: m.url,
      docType: m.docType,
      snippet: buildSnippet(r.doc.body, queryTerms),
      score: Number(r.score.toFixed(4)),
    }
    if (r.bm25Score !== null) out.bm25Score = Number(r.bm25Score.toFixed(4))
    if (r.vecScore !== null) out.vecScore = Number(r.vecScore.toFixed(4))
    if (m.techId) out.techId = m.techId
    if (m.wcagVersion) out.wcagVersion = m.wcagVersion
    return out
  })

  return { results, total_indexed: corpus.N, mode }
}

module.exports = { searchWcag, tokenize, loadCorpus }
