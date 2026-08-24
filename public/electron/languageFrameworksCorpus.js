// Lexical BM25 search over the on-disk framework/language docs corpus at
// `public/electron/frameworks-index/`. The directory ships as pairs of
// `<uuid>.pb` (JSON metadata: title, sectionTitle, url, docType, family,
// path) and `<uuid>.txt` (the chunk body). Despite the extension, the `.pb`
// files are plain JSON — matches the sibling `wcagCorpus.js` file layout.
//
// Consumed by the `search_language_and_frameworks` tool exposed to both
// Anthropic and Gemma tool-use loops in llmAnalysis.js. Kept separate from
// wcagCorpus.js: retrieval scoring on framework/language queries would
// otherwise pollute the WCAG BM25 relevance (e.g. "React useId" pulling in
// unrelated WCAG snippets, or a WCAG SC number matching a framework code
// example that happens to contain the same digits).

const fs = require('fs')
const path = require('path')

const K1 = 1.5
const B = 0.75
const TITLE_BOOST = 3
const SECTION_BOOST = 2
const FAMILY_BOOST = 3
const SNIPPET_CHARS = 500

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to',
  'in', 'on', 'for', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it',
  'its', 'not', 'no', 'do', 'does', 'did', 'so', 'than', 'which', 'who',
  'what', 'when', 'where', 'why', 'how',
])

// Tokenize: same dot-preserving rules as wcagCorpus.js. Framework/language
// queries lean on dotted identifiers ("React.useState", "Array.prototype.map",
// ".tsx", "@Input()"), so preserve tokens containing '.' and also emit each
// segment so a query for just "useState" or "prototype" still matches.
const DOTTED_RE = /^[a-z0-9]+(?:\.[a-z0-9]+)+$/
function tokenize(text) {
  if (!text) return []
  const out = []
  const raw = String(text)
    .toLowerCase()
    .split(/[^a-z0-9.]+/g)
  for (let tok of raw) {
    if (!tok) continue
    tok = tok.replace(/^\.+|\.+$/g, '')
    if (!tok) continue
    if (STOPWORDS.has(tok)) continue
    if (DOTTED_RE.test(tok)) {
      out.push(tok)
      for (const piece of tok.split('.')) {
        if (piece && !STOPWORDS.has(piece)) out.push(piece)
      }
      continue
    }
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
    throw new Error(`Frameworks index directory not found: ${dir}`)
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
    // family (react/vue/angular/javascript/typescript) is the primary
    // disambiguator between corpora — boost it like a title token so a
    // query mentioning "react" preferentially lands on react docs.
    const familyTokens = meta.family ? tokenize(meta.family) : []
    const bodyTokens = tokenize(body)

    const tf = new Map()
    const bump = (toks, w) => {
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + w)
    }
    bump(bodyTokens, 1)
    bump(sectionTokens, SECTION_BOOST)
    bump(titleTokens, TITLE_BOOST)
    bump(familyTokens, FAMILY_BOOST)

    const dl =
      bodyTokens.length +
      sectionTokens.length * SECTION_BOOST +
      titleTokens.length * TITLE_BOOST +
      familyTokens.length * FAMILY_BOOST
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
    const idf = Math.max(0, Math.log((N - n + 0.5) / (n + 0.5) + 1))
    const denom = tf + K1 * (1 - B + B * (doc.dl / (avgDl || 1)))
    score += idf * ((tf * (K1 + 1)) / denom)
  }
  return score
}

function buildSnippet(body, queryTerms) {
  if (!body) return ''
  const lower = body.toLowerCase()
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

const VALID_FAMILIES = new Set(['react', 'vue', 'angular', 'javascript', 'typescript'])

function searchLanguageAndFrameworks({ dir, query, topK = 5, family = null }) {
  const corpus = loadCorpus(dir)
  const rawTerms = tokenize(query)
  const queryTerms = Array.from(new Set(rawTerms))
  if (queryTerms.length === 0) {
    return { results: [], total_indexed: corpus.N, note: 'Query had no indexable tokens.' }
  }

  const familyFilter =
    family && VALID_FAMILIES.has(String(family).toLowerCase())
      ? String(family).toLowerCase()
      : null

  const scored = []
  for (const doc of corpus.docs) {
    if (familyFilter && doc.meta.family !== familyFilter) continue
    const s = scoreDoc(doc, queryTerms, corpus.df, corpus.N, corpus.avgDl)
    if (s > 0) scored.push({ doc, score: s })
  }
  scored.sort((a, b) => b.score - a.score)

  const results = scored.slice(0, topK).map(({ doc, score }) => {
    const m = doc.meta
    return {
      id: doc.id,
      title: m.title,
      sectionTitle: m.sectionTitle,
      url: m.url,
      docType: m.docType,
      family: m.family,
      path: m.path,
      snippet: buildSnippet(doc.body, queryTerms),
      score: Number(score.toFixed(4)),
    }
  })

  return { results, total_indexed: corpus.N, family_filter: familyFilter }
}

module.exports = { searchLanguageAndFrameworks, tokenize, loadCorpus }
