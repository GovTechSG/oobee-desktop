const { ipcMain, nativeImage } = require('electron')
const fs = require('fs-extra')
const path = require('path')
const zlib = require('zlib')
const axios = require('axios')
const { loadLLMConfig } = require('./llm-config')
const { buildSystemPrompt, TOOL_SCHEMAS } = require('./llmPrompts')
const { streamGemmaChat, disposeSession: disposeGemmaSession, unloadModel: unloadGemmaModel, ensureModel: ensureGemmaModel } = require('./llmGemma')
const { searchWcag } = require('./wcagCorpus')
const { getWcagIndexPath } = require('./constants')

const MAX_DOM_CHARS = 30_000
const MAX_ELEMENT_CONTEXT_CHARS = 10_000
const MAX_ELEMENT_CONTEXT_DEPTH = 5
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
const MAX_ELEM_SCREENSHOT_BYTES = 1 * 1024 * 1024
const MAX_ELEM_SCREENSHOTS_PER_CALL = 4
// Anthropic rejects images whose width or height exceeds 8000 px. Full-page
// scan screenshots routinely exceed that on the long axis, so we downscale
// with a small safety margin before sending.
const ANTHROPIC_MAX_IMAGE_DIM = 7680
const MAX_TOOL_ITEMS = 20
const MAX_INDEX_KB = 30
const ANTHROPIC_VERSION = '2023-06-01'

// Lazy-load cheerio to keep the import surface small; it's only used by
// get_element_context and pulls a moderate transitive tree (parse5 + css-select).
let _cheerio = null
const cheerio = () => {
  if (_cheerio) return _cheerio
  _cheerio = require('cheerio')
  return _cheerio
}

const mediaTypeForPath = (rel) => {
  const lower = String(rel || '').toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

// Oobee writes some HTML element screenshots with a .jpeg extension but PNG
// bytes inside; Anthropic rejects the tool result when the declared media
// type doesn't match. Sniff magic bytes and only fall back to the extension.
const sniffMediaType = (buf, rel) => {
  if (buf && buf.length >= 8) {
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) {
      return 'image/png'
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
    if (
      buf[0] === 0x47 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x38
    ) {
      return 'image/gif'
    }
    if (
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    ) {
      return 'image/webp'
    }
  }
  return mediaTypeForPath(rel)
}

// Anthropic rejects images with either dimension > 8000 px. Full-page scan
// screenshots can be 20k+ px tall, so decode with nativeImage, downscale
// preserving aspect ratio when needed, and re-encode as PNG. Returns
// { buf, mediaType } — original inputs when no resize is needed or when
// decoding fails (in which case the API will surface a clearer error than
// silent truncation).
const constrainImageForAnthropic = (buf, mediaType) => {
  try {
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) return { buf, mediaType }
    const { width, height } = img.getSize()
    if (width <= ANTHROPIC_MAX_IMAGE_DIM && height <= ANTHROPIC_MAX_IMAGE_DIM) {
      return { buf, mediaType }
    }
    const scale = ANTHROPIC_MAX_IMAGE_DIM / Math.max(width, height)
    const resized = img.resize({
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      quality: 'good',
    })
    return { buf: resized.toPNG(), mediaType: 'image/png' }
  } catch (e) {
    warn(`image resize failed: ${e.message}`)
    return { buf, mediaType }
  }
}

const sessions = new Map() // sessionId -> { storagePath, cfg, artifacts, summary, systemPrompt, messages, abort }

const log = (...args) => console.log('[llmAnalysis]', ...args)
const warn = (...args) => console.warn('[llmAnalysis]', ...args)

function readGzB64(filePath) {
  const b64 = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'))
}

function tryReadGzB64(storagePath, name) {
  const p = path.join(storagePath, name)
  if (!fs.existsSync(p)) return null
  try {
    return readGzB64(p)
  } catch (e) {
    warn(`failed to decode ${name}: ${e.message}`)
    return null
  }
}

function loadArtifacts(storagePath) {
  log(`loading artifacts from ${storagePath}`)
  try {
    log('storagePath listing:', fs.readdirSync(storagePath).slice(0, 40))
  } catch (_) {
    // best-effort log
  }
  const scanData = tryReadGzB64(storagePath, 'scanData.json.gz.b64')
  // Load scanIssuesSummary eagerly — it has per-category rule arrays we need
  // for the summary card + system-prompt findings index. scanItemsSummary only
  // has aggregate counts, not per-rule detail.
  const scanIssuesSummary = tryReadGzB64(storagePath, 'scanIssuesSummary.json.gz.b64')
  return {
    scanData,
    scanIssuesSummary,
    getScanItems: () => tryReadGzB64(storagePath, 'scanItems.json.gz.b64'),
    getPagesSummary: () => tryReadGzB64(storagePath, 'scanPagesSummary.json.gz.b64'),
    getPagesDetail: () => tryReadGzB64(storagePath, 'scanPagesDetail.json.gz.b64'),
    getManifest: () => {
      const p = path.join(storagePath, 'pageDOMs', 'domManifest.json')
      if (!fs.existsSync(p)) return { pages: [] }
      try {
        return fs.readJsonSync(p)
      } catch (e) {
        warn(`failed to read domManifest.json: ${e.message}`)
        return { pages: [] }
      }
    },
  }
}

// scanIssuesSummary shape: { mustFix: [rule, ...], goodToFix: [...], needsReview: [...] }
// scanItems shape:         { mustFix: { rules: [rule, ...], totalItems, ... }, ... }
// Each `rule` has { rule, description, axeImpact, conformance, totalItems, htmlGroups, pagesAffected }.
function issuesSummaryRules(sis, cat) {
  const arr = sis?.[cat]
  return Array.isArray(arr) ? arr : []
}

function scanItemsRules(items, cat) {
  const catObj = items?.[cat]
  if (!catObj) return []
  return Array.isArray(catObj.rules) ? catObj.rules : []
}

function parsePct(s) {
  if (typeof s === 'number') return s
  if (typeof s === 'string') {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Axe/oobee report WCAG conformance as raw axe tags (`wcag211`, `wcag412`,
// plus level tags like `wcag2a` / `wcag21aa`). LLMs consistently hallucinate
// against these — Gemma invented WCAG 2.4.4 and 1.1.1 when shown `wcag211,
// wcag412` for oobee-accessible-label. Expand numeric tags into human WCAG SC
// references (`WCAG 2.1.1`) and drop level tags so downstream prompts/tool
// results only expose things the model can cite verbatim.
const WCAG_LEVEL_TAG_RE = /^wcag(2|21|22)(a|aa|aaa)$/
const WCAG_SC_TAG_RE = /^wcag(\d)(\d)(\d+)$/
function formatWcagConformance(tags) {
  if (!Array.isArray(tags)) return []
  const out = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const t = raw.trim().toLowerCase()
    if (!t || WCAG_LEVEL_TAG_RE.test(t)) continue
    const m = t.match(WCAG_SC_TAG_RE)
    if (m) out.push(`WCAG ${m[1]}.${m[2]}.${m[3]}`)
    else out.push(raw)
  }
  return out
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k]
  return out
}

// --- CSS selector helpers for get_page_computed_styles ---
// axe reports CSS selectors under a finding's `xpath` field. They can be
// anything a CSS parser accepts: `.class`, `#id`, tag paths, and — crucially —
// attribute selectors like `span > a[href$="#foo"]`. The computed-styles JSON
// stores each element as a flat record with { selector (nth-of-type path),
// tag, id?, classes?, outerHtmlPrefix, styles }. We don't have a live DOM to
// run querySelectorAll against, so match on the LEAF simple selector (the
// trailing token after combinators) which is what actually identifies the
// failing element.

// Extract the last simple selector after descendant/child/sibling combinators,
// respecting brackets and parens so `a[href$=" > x"]` isn't split.
function selectorLeaf(query) {
  let depth = 0
  let last = 0
  const parts = []
  for (let i = 0; i < query.length; i++) {
    const c = query[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && /[>\s+~]/.test(c)) {
      if (i > last) parts.push(query.slice(last, i))
      last = i + 1
    }
  }
  if (last < query.length) parts.push(query.slice(last))
  const nonEmpty = parts.map((p) => p.trim()).filter((p) => p && !/^[>+~]$/.test(p))
  return nonEmpty.length ? nonEmpty[nonEmpty.length - 1] : query.trim()
}

// Parse one simple selector like `a[href$="foo"].bar#baz:hover` into a struct.
// Handles CSS backslash escapes in id/class names, so Tailwind variants like
// `.hover\:text-default` and `.md\:py-6` parse to their real class names
// (`hover:text-default`, `md:py-6`) — axe reports these escapes verbatim.
function unescapeCssIdent(s) {
  return s.replace(/\\(.)/g, '$1')
}
function parseSimpleSelector(text) {
  const out = { tag: null, id: null, classes: [], attrs: [] }
  let rest = text.trim()
  const tagMatch = rest.match(/^(\*|[a-zA-Z][a-zA-Z0-9-]*)/)
  if (tagMatch) {
    out.tag = tagMatch[1] === '*' ? '*' : tagMatch[1].toLowerCase()
    rest = rest.slice(tagMatch[0].length)
  }
  const IDENT = /^((?:[A-Za-z0-9_\-]|\\.)+)/
  while (rest.length > 0) {
    const ch = rest[0]
    if (ch === '#') {
      const m = rest.slice(1).match(IDENT)
      if (!m) break
      out.id = unescapeCssIdent(m[1])
      rest = rest.slice(1 + m[0].length)
    } else if (ch === '.') {
      const m = rest.slice(1).match(IDENT)
      if (!m) break
      out.classes.push(unescapeCssIdent(m[1]))
      rest = rest.slice(1 + m[0].length)
    } else if (ch === '[') {
      const m = rest.match(
        /^\[\s*([A-Za-z_][A-Za-z0-9_\-:]*)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/
      )
      if (!m) break
      out.attrs.push({
        name: m[1].toLowerCase(),
        op: m[2] || null,
        value: m[3] ?? m[4] ?? m[5] ?? null,
      })
      rest = rest.slice(m[0].length)
    } else if (ch === ':') {
      // Skip pseudo-classes/elements — we can't evaluate :hover, :nth-child,
      // etc. against a static capture without a real DOM. Best-effort ignore.
      const m = rest.match(/^::?[A-Za-z\-]+(?:\([^)]*\))?/)
      if (!m) break
      rest = rest.slice(m[0].length)
    } else {
      break
    }
  }
  return out
}

// Parse the opening tag's attributes out of the stored outerHtmlPrefix. The
// prefix is capped at 200 chars at capture time, so the opening tag may be
// truncated for very large ones; we parse what we have.
function parseOpeningTagAttrs(outerHtmlPrefix) {
  if (!outerHtmlPrefix) return {}
  const openMatch = outerHtmlPrefix.match(/^<[a-zA-Z][a-zA-Z0-9-]*([\s\S]*?)(?:\/?>|$)/)
  if (!openMatch) return {}
  const attrStr = openMatch[1]
  const attrs = {}
  const re = /\s+([a-zA-Z_:][a-zA-Z0-9_.:\-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

function attrFilterMatches(value, filter) {
  if (value === undefined || value === null) return filter.op === null ? false : false
  if (filter.op === null) return true
  const v = String(filter.value ?? '')
  switch (filter.op) {
    case '=':
      return value === v
    case '^=':
      return value.startsWith(v)
    case '$=':
      return value.endsWith(v)
    case '*=':
      return value.includes(v)
    case '~=':
      return value.split(/\s+/).includes(v)
    case '|=':
      return value === v || value.startsWith(v + '-')
    default:
      return false
  }
}

function elementMatchesLeaf(el, leaf, attrCache) {
  if (leaf.tag && leaf.tag !== '*' && el.tag !== leaf.tag) return false
  if (leaf.id && el.id !== leaf.id) return false
  if (leaf.classes.length > 0) {
    if (!Array.isArray(el.classes)) return false
    for (const c of leaf.classes) if (!el.classes.includes(c)) return false
  }
  if (leaf.attrs.length > 0) {
    let attrs = attrCache.get(el)
    if (attrs === undefined) {
      attrs = parseOpeningTagAttrs(el.outerHtmlPrefix)
      if (el.id != null && attrs.id === undefined) attrs.id = String(el.id)
      if (Array.isArray(el.classes) && attrs.class === undefined) {
        attrs.class = el.classes.join(' ')
      }
      attrCache.set(el, attrs)
    }
    for (const f of leaf.attrs) if (!attrFilterMatches(attrs[f.name], f)) return false
  }
  return true
}

function computeSummary(artifacts) {
  const sd = artifacts.scanData || {}
  const sis = artifacts.scanIssuesSummary || {}
  try {
    log('scanData keys:', Object.keys(sd))
    log('scanIssuesSummary keys:', Object.keys(sis))
  } catch (_) {
    // best-effort log
  }

  // Per-category rule arrays live at the top level of scanIssuesSummary.
  const mustFixRules = issuesSummaryRules(sis, 'mustFix')
  const goodToFixRules = issuesSummaryRules(sis, 'goodToFix')
  const needsReviewRules = issuesSummaryRules(sis, 'needsReview')

  const sumTotalItems = (rules) =>
    rules.reduce((n, r) => n + (Number(r?.totalItems) || 0), 0)

  const mustFixCount = { rules: mustFixRules.length, occurrences: sumTotalItems(mustFixRules) }
  const goodToFixCount = { rules: goodToFixRules.length, occurrences: sumTotalItems(goodToFixRules) }
  const needsReviewCount = {
    rules: needsReviewRules.length,
    occurrences: sumTotalItems(needsReviewRules),
  }

  const topN = (rules) =>
    [...rules]
      .sort((a, b) => (b?.totalItems ?? 0) - (a?.totalItems ?? 0))
      .slice(0, 5)
      .map((r) => ({
        rule: r?.rule ?? r?.ruleId ?? '',
        description: r?.description ?? '',
        totalItems: r?.totalItems ?? 0,
        axeImpact: r?.axeImpact ?? '',
        conformance: formatWcagConformance(r?.conformance ?? r?.wcagConformance ?? []),
      }))

  const topRulesByCategory = {
    mustFix: topN(mustFixRules),
    goodToFix: topN(goodToFixRules),
    needsReview: topN(needsReviewRules),
  }

  const topPages = Array.isArray(sd.topFiveMostIssues)
    ? sd.topFiveMostIssues.map((p) => ({
        url: p.url,
        pageTitle: p.pageTitle,
        totalIssues:
          p.totalIssues ??
          p.totalOccurrencesFailedIncludingNeedsReview ??
          p.totalOccurrencesFailed ??
          0,
      }))
    : []

  // scanData.wcagPassPercentage is an object of string percentages, not a number.
  // Prefer the AA+AAA combined score when present so users see the full picture.
  const wcagObj = sd.wcagPassPercentage
  const wcagPassPercentage =
    (wcagObj && typeof wcagObj === 'object'
      ? parsePct(wcagObj.passPercentageAAandAAA) ?? parsePct(wcagObj.passPercentageAA)
      : parsePct(wcagObj)) ?? null

  // Raw AA check counts — same shape oobee's summary EJS renders (X of Y
  // automated checks). Denominator is typically ~20.
  const wcagChecksTotal =
    wcagObj && typeof wcagObj === 'object' ? Number(wcagObj.totalWcagChecksAA) : NaN
  const wcagViolations =
    wcagObj && typeof wcagObj === 'object' ? Number(wcagObj.totalWcagViolationsAA) : NaN
  const wcagChecksPassed =
    Number.isFinite(wcagChecksTotal) && Number.isFinite(wcagViolations)
      ? Math.max(0, wcagChecksTotal - wcagViolations)
      : null

  // Compact findings index for the system prompt (rules + descriptions + counts).
  // Cap total serialized size at ~MAX_INDEX_KB so we don't blow the context.
  const compactRule = (r) => {
    const base = pick(r, ['rule', 'ruleId', 'description', 'totalItems', 'axeImpact', 'conformance'])
    if (base.conformance !== undefined) base.conformance = formatWcagConformance(base.conformance)
    return base
  }
  const findingsIndex = {
    mustFix: [...mustFixRules].sort((a, b) => (b.totalItems ?? 0) - (a.totalItems ?? 0)).map(compactRule),
    goodToFix: [...goodToFixRules].sort((a, b) => (b.totalItems ?? 0) - (a.totalItems ?? 0)).map(compactRule),
    needsReview: [...needsReviewRules]
      .sort((a, b) => (b.totalItems ?? 0) - (a.totalItems ?? 0))
      .map(compactRule),
  }
  // Truncate if too large.
  if (JSON.stringify(findingsIndex).length > MAX_INDEX_KB * 1024) {
    for (const cat of Object.keys(findingsIndex)) {
      findingsIndex[cat] = findingsIndex[cat].map((r) =>
        pick(r, ['rule', 'ruleId', 'description', 'totalItems'])
      )
    }
    if (JSON.stringify(findingsIndex).length > MAX_INDEX_KB * 1024) {
      for (const cat of Object.keys(findingsIndex)) {
        findingsIndex[cat] = findingsIndex[cat].slice(0, 30)
      }
    }
  }

  return {
    siteName: sd.siteName,
    urlScanned: sd.urlScanned || sd.url,
    startTime: sd.startTime,
    viewport: sd.viewport,
    oobeeAppVersion: sd.oobeeAppVersion,
    wcagPassPercentage,
    wcagChecksPassed,
    wcagChecksTotal: Number.isFinite(wcagChecksTotal) ? wcagChecksTotal : null,
    totalPagesScanned: sd.totalPagesScanned ?? 0,
    totalPagesNotScanned: sd.totalPagesNotScanned ?? 0,
    mustFixRules: mustFixCount.rules,
    mustFixOccurrences: mustFixCount.occurrences,
    goodToFixRules: goodToFixCount.rules,
    goodToFixOccurrences: goodToFixCount.occurrences,
    needsReviewRules: needsReviewCount.rules,
    needsReviewOccurrences: needsReviewCount.occurrences,
    topRulesByCategory,
    topPages,
    findingsIndex,
  }
}

function runTool(session, name, input) {
  const { artifacts } = session
  input = input || {}
  try {
    const inputStr = JSON.stringify(input)
    log(`tool: ${name}(${inputStr.length > 200 ? inputStr.slice(0, 200) + '…' : inputStr})`)
  } catch (_) {
    log(`tool: ${name}`)
  }
  switch (name) {
    case 'list_findings': {
      const sis = artifacts.scanIssuesSummary || {}
      const cats = input.category
        ? [input.category]
        : ['mustFix', 'goodToFix', 'needsReview']
      const limit = Math.min(input.limit ?? 20, 100)
      const offset = input.offset ?? 0
      const out = []
      for (const cat of cats) {
        for (const r of issuesSummaryRules(sis, cat)) {
          if (input.ruleId && (r.rule ?? r.ruleId) !== input.ruleId) continue
          out.push({
            category: cat,
            rule: r.rule ?? r.ruleId,
            description: r.description,
            totalItems: r.totalItems,
            axeImpact: r.axeImpact,
            conformance: formatWcagConformance(r.conformance ?? r.wcagConformance),
          })
        }
      }
      return {
        total: out.length,
        offset,
        limit,
        findings: out.slice(offset, offset + limit),
      }
    }
    case 'get_finding_detail': {
      const items = artifacts.getScanItems() || {}
      const rules = scanItemsRules(items, input.category)
      const match = rules.find((r) => (r.rule ?? r.ruleId) === input.ruleId)
      if (!match) return { error: `Rule not found: ${input.category}/${input.ruleId}` }
      const limit = Math.min(input.limit ?? MAX_TOOL_ITEMS, 50)
      // Each rule has `pagesAffected: [{url, pageTitle, items: [{html, message, xpath, ...}]}]`.
      // Flatten to a single list of occurrences, keeping page context.
      const pagesAffected = Array.isArray(match.pagesAffected) ? match.pagesAffected : []
      const occurrences = []
      for (const p of pagesAffected) {
        for (const it of p.items || []) {
          occurrences.push({
            url: p.url,
            pageTitle: p.pageTitle,
            html: it.html,
            message: it.message,
            xpath: it.xpath,
            screenshotPath: it.screenshotPath || '',
          })
        }
      }
      const sliced = occurrences.slice(0, limit)

      // Attach element screenshots when the scan captured them. If screenshots
      // were disabled at scan time, `screenshotPath` will be empty (or the file
      // won't exist) and we simply skip — no error, no placeholder.
      const attachments = []
      for (let i = 0; i < sliced.length && attachments.length < MAX_ELEM_SCREENSHOTS_PER_CALL; i++) {
        const rel = sliced[i].screenshotPath
        if (!rel) continue
        const abs = path.join(session.storagePath, rel)
        if (!fs.existsSync(abs)) continue
        let buf
        try {
          buf = fs.readFileSync(abs)
        } catch (_) {
          continue
        }
        if (!buf || buf.length === 0 || buf.length > MAX_ELEM_SCREENSHOT_BYTES) continue
        const constrained = constrainImageForAnthropic(buf, sniffMediaType(buf, rel))
        attachments.push({
          occurrenceIndex: i,
          url: sliced[i].url,
          pageTitle: sliced[i].pageTitle,
          xpath: sliced[i].xpath,
          mediaType: constrained.mediaType,
          base64: constrained.buf.toString('base64'),
        })
      }

      const payload = {
        rule: match.rule ?? match.ruleId,
        category: input.category,
        description: match.description,
        axeImpact: match.axeImpact,
        conformance: formatWcagConformance(match.conformance ?? match.wcagConformance),
        helpUrl: match.helpUrl,
        totalItems: match.totalItems ?? occurrences.length,
        occurrences: sliced,
        truncated: occurrences.length > limit,
        screenshotsAttached: attachments.length,
      }

      if (attachments.length === 0) return payload
      return { __attachments: attachments, payload }
    }
    case 'list_pages': {
      const ps = artifacts.getPagesSummary() || {}
      const arr = Array.isArray(ps.pagesAffected) ? ps.pagesAffected : []
      const limit = Math.min(input.limit ?? 50, 200)
      const offset = input.offset ?? 0
      return {
        total: arr.length,
        offset,
        limit,
        pages: arr.slice(offset, offset + limit).map((p) => ({
          url: p.url,
          pageTitle: p.pageTitle,
          totalOccurrencesFailedIncludingNeedsReview:
            p.totalOccurrencesFailedIncludingNeedsReview ?? p.totalOccurrencesFailed,
          totalOccurrencesMustFix: p.totalOccurrencesMustFix,
          totalOccurrencesGoodToFix: p.totalOccurrencesGoodToFix,
          totalOccurrencesNeedsReview: p.totalOccurrencesNeedsReview,
          typesOfIssuesCount: p.typesOfIssuesCount,
        })),
      }
    }
    case 'get_page_detail': {
      const pd = artifacts.getPagesDetail() || {}
      const affected = Array.isArray(pd.pagesAffected) ? pd.pagesAffected : []
      const notAffected = Array.isArray(pd.pagesNotAffected) ? pd.pagesNotAffected : []
      const match =
        affected.find((p) => p.url === input.pageUrl) ??
        notAffected.find((p) => p.url === input.pageUrl)
      if (!match) return { error: `Page not found: ${input.pageUrl}` }
      return match
    }
    case 'list_page_captures': {
      const manifest = artifacts.getManifest()
      return {
        pages: (manifest.pages || []).map((p) => ({
          url: p.url,
          hash: p.hash,
          hasDesktopDom: !!p.desktopDom,
          hasMobileDom: !!p.mobileDom,
          hasDesktopScreenshot: !!p.desktopScreenshot,
          hasMobileScreenshot: !!p.mobileScreenshot,
          hasDesktopComputedStyles: !!p.desktopComputedStyles,
          hasMobileComputedStyles: !!p.mobileComputedStyles,
        })),
      }
    }
    case 'get_page_dom': {
      const manifest = artifacts.getManifest()
      const entry = (manifest.pages || []).find((p) => p.url === input.pageUrl)
      if (!entry) return { error: `Page not captured: ${input.pageUrl}` }
      const viewport = input.viewport === 'mobile' ? 'mobile' : 'desktop'
      const rel = viewport === 'mobile' ? entry.mobileDom : entry.desktopDom
      if (!rel) return { error: `No ${viewport} DOM captured for ${input.pageUrl}` }
      const abs = path.join(session.storagePath, rel)
      if (!fs.existsSync(abs)) return { error: `DOM file missing: ${rel}` }
      const html = fs.readFileSync(abs, 'utf8')
      const truncated = html.length > MAX_DOM_CHARS
      return {
        pageUrl: input.pageUrl,
        viewport,
        html: truncated ? html.slice(0, MAX_DOM_CHARS) : html,
        truncated,
        totalChars: html.length,
      }
    }
    case 'get_element_context': {
      // Locate a failing element in the captured DOM via CSS selector, walk up
      // N ancestor levels, return that ancestor's outerHTML so the model can
      // reason about siblings and existing ids (e.g. aria-labelledby targets)
      // without inventing DOM that isn't there.
      const manifest = artifacts.getManifest()
      const entry = (manifest.pages || []).find((p) => p.url === input.pageUrl)
      if (!entry) return { error: `Page not captured: ${input.pageUrl}` }
      const viewport = input.viewport === 'mobile' ? 'mobile' : 'desktop'
      const rel = viewport === 'mobile' ? entry.mobileDom : entry.desktopDom
      if (!rel) return { error: `No ${viewport} DOM captured for ${input.pageUrl}` }
      const abs = path.join(session.storagePath, rel)
      if (!fs.existsSync(abs)) return { error: `DOM file missing: ${rel}` }

      const selector = String(input.selector || '').trim()
      if (!selector) {
        return {
          error:
            'selector is required. Pass the CSS selector for the failing element (the finding\'s xpath field).',
        }
      }
      const rawDepth = Number.isFinite(input.ancestorDepth) ? input.ancestorDepth : 2
      const ancestorDepth = Math.max(1, Math.min(rawDepth, MAX_ELEMENT_CONTEXT_DEPTH))

      const html = fs.readFileSync(abs, 'utf8')
      let $
      try {
        $ = cheerio().load(html, { decodeEntities: false })
      } catch (e) {
        return { error: `Failed to parse DOM: ${e.message}` }
      }

      let target
      try {
        target = $(selector).first()
      } catch (e) {
        return { error: `Invalid selector "${selector}": ${e.message}` }
      }
      if (!target || target.length === 0) {
        return {
          pageUrl: input.pageUrl,
          viewport,
          selector,
          ancestorDepth,
          error: `No element matched selector "${selector}" in captured DOM. The selector may reference a dynamically injected node not present in the static capture.`,
        }
      }

      // Walk up to the requested depth, stopping if we hit the document root.
      // parents() returns nearest-first; parent[0] is direct parent.
      const parentsChain = target.parents().toArray()
      const requestedIdx = ancestorDepth - 1
      const effectiveIdx = Math.min(requestedIdx, parentsChain.length - 1)
      const ancestorNode = parentsChain[effectiveIdx]
      const ancestor = ancestorNode ? $(ancestorNode) : target
      const effectiveDepth = ancestorNode ? effectiveIdx + 1 : 0

      const targetHtml = $.html(target)
      const ancestorHtmlRaw = $.html(ancestor)
      const truncated = ancestorHtmlRaw.length > MAX_ELEMENT_CONTEXT_CHARS
      const ancestorHtml = truncated
        ? ancestorHtmlRaw.slice(0, MAX_ELEMENT_CONTEXT_CHARS)
        : ancestorHtmlRaw

      return {
        pageUrl: input.pageUrl,
        viewport,
        selector,
        requestedAncestorDepth: ancestorDepth,
        effectiveAncestorDepth: effectiveDepth,
        ancestorTag: ancestor.get(0)?.tagName || null,
        targetTag: target.get(0)?.tagName || null,
        targetHtml,
        ancestorHtml,
        truncated,
        totalAncestorChars: ancestorHtmlRaw.length,
        note:
          effectiveDepth < ancestorDepth
            ? `Only ${effectiveDepth} ancestor levels exist above the target (capped by document root).`
            : undefined,
      }
    }
    case 'get_page_computed_styles': {
      // Reads the per-page computed-styles JSON produced by oobee when the
      // scan runs with OOBEE_SAVE_COMPUTED_STYLES=1. The file lists every
      // element on the page with a curated ~22-property getComputedStyle
      // dump. This is the only way to see CSS that lives in an external
      // stylesheet (which get_page_css cannot reach).
      const manifest = artifacts.getManifest()
      const entry = (manifest.pages || []).find((p) => p.url === input.pageUrl)
      if (!entry) return { error: `Page not captured: ${input.pageUrl}` }
      const viewport = input.viewport === 'mobile' ? 'mobile' : 'desktop'
      const rel = viewport === 'mobile' ? entry.mobileComputedStyles : entry.desktopComputedStyles
      if (!rel) {
        return {
          error: `No computed styles captured for ${input.pageUrl} (${viewport}). The scan was run without OOBEE_SAVE_COMPUTED_STYLES=1. Fall back to get_page_css to inspect inline <style> blocks.`,
        }
      }
      const abs = path.join(session.storagePath, rel)
      if (!fs.existsSync(abs)) return { error: `Computed styles file missing: ${rel}` }
      const raw = fs.readFileSync(abs, 'utf8')
      let doc
      try {
        doc = JSON.parse(raw)
      } catch (e) {
        return { error: `Computed styles file corrupt: ${e.message}` }
      }
      const elements = Array.isArray(doc.elements) ? doc.elements : []

      const q = String(input.selector || '').trim()
      if (!q) {
        return {
          error:
            'selector is required. Pass the CSS selector for the element you care about (e.g. ".warning2-text").',
        }
      }

      // Match on the LEAF simple selector (last token after combinators),
      // parsed into tag + id + classes + attribute filters. Attributes are
      // resolved from each element's captured outerHtmlPrefix so axe targets
      // like `span > a[href$="#foo"]` work — the earlier substring-match
      // strategy silently failed for anything beyond `.class` / `#id`.
      const leafText = selectorLeaf(q)
      const leaf = parseSimpleSelector(leafText)

      const attrCache = new Map()
      const matches = []
      for (const el of elements) {
        if (elementMatchesLeaf(el, leaf, attrCache)) matches.push(el)
      }

      const limitInput = Number.isFinite(input.limit) ? input.limit : 5
      const limit = Math.max(1, Math.min(limitInput, 20))
      const sliced = matches.slice(0, limit)

      if (matches.length === 0) {
        // Orientation payload so the model can revise the selector instead
        // of concluding "no data". Include a sample of outerHtmlPrefix so
        // attribute-selector authors can see what's actually on the page.
        const idSample = elements
          .map((e) => e.id)
          .filter(Boolean)
          .slice(0, 20)
        const classSample = new Set()
        for (const e of elements) {
          if (!Array.isArray(e.classes)) continue
          for (const c of e.classes) {
            classSample.add(c)
            if (classSample.size >= 30) break
          }
          if (classSample.size >= 30) break
        }
        const tagSample = leaf.tag && leaf.tag !== '*'
          ? elements
              .filter((e) => e.tag === leaf.tag)
              .slice(0, 10)
              .map((e) => ({ selector: e.selector, outerHtmlPrefix: e.outerHtmlPrefix }))
          : []
        return {
          pageUrl: input.pageUrl,
          viewport,
          selector: q,
          leafParsed: leaf,
          matches: [],
          totalElements: elements.length,
          idSample,
          classSample: Array.from(classSample),
          tagSample,
          note:
            'No elements matched the leaf simple selector. Samples above show what is on the page; revise the selector or drop attribute filters that may not match the captured outerHtmlPrefix (first 200 chars).',
        }
      }

      return {
        pageUrl: input.pageUrl,
        viewport,
        selector: q,
        leafMatched: leafText,
        propertiesCaptured: doc.properties || [],
        totalMatches: matches.length,
        truncated: matches.length > limit,
        matches: sliced,
      }
    }
    case 'get_page_css': {
      // Extract inline <style> block bodies and external stylesheet URLs from
      // the captured DOM. External CSS isn't captured by the scan, so this
      // tool's job is dual: (a) hand over the inline CSS the model can
      // actually reason about, (b) name the external files so the model can
      // be honest about what it can't see, rather than guessing colours.
      const manifest = artifacts.getManifest()
      const entry = (manifest.pages || []).find((p) => p.url === input.pageUrl)
      if (!entry) return { error: `Page not captured: ${input.pageUrl}` }
      const viewport = input.viewport === 'mobile' ? 'mobile' : 'desktop'
      const rel = viewport === 'mobile' ? entry.mobileDom : entry.desktopDom
      if (!rel) return { error: `No ${viewport} DOM captured for ${input.pageUrl}` }
      const abs = path.join(session.storagePath, rel)
      if (!fs.existsSync(abs)) return { error: `DOM file missing: ${rel}` }
      const html = fs.readFileSync(abs, 'utf8')

      const inlineStyleBlocks = []
      const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi
      let m
      while ((m = styleRe.exec(html)) !== null) inlineStyleBlocks.push(m[1])
      const inlineBytes = inlineStyleBlocks.reduce((n, s) => n + s.length, 0)

      const externalStylesheetUrls = []
      const linkRe = /<link\b[^>]*>/gi
      while ((m = linkRe.exec(html)) !== null) {
        const tag = m[0]
        if (!/rel\s*=\s*["'][^"']*stylesheet[^"']*["']/i.test(tag)) continue
        const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)
        if (href) externalStylesheetUrls.push(href[1])
      }

      const MAX_CSS_BYTES = 40_000
      let truncated = false
      const clippedBlocks = []
      let running = 0
      for (const s of inlineStyleBlocks) {
        if (running + s.length > MAX_CSS_BYTES) {
          clippedBlocks.push(s.slice(0, Math.max(0, MAX_CSS_BYTES - running)))
          truncated = true
          break
        }
        clippedBlocks.push(s)
        running += s.length
      }

      return {
        pageUrl: input.pageUrl,
        viewport,
        inlineStyleBlocks: clippedBlocks,
        inlineStyleBlocksBytes: inlineBytes,
        externalStylesheetUrls,
        hasExternalStylesheets: externalStylesheetUrls.length > 0,
        truncated,
        note: 'External stylesheet contents are NOT captured by the scan. If the failing CSS rule is not visible in inlineStyleBlocks, it lives in one of the externalStylesheetUrls and cannot be inspected. Say so plainly instead of guessing.',
      }
    }
    case 'get_page_screenshot': {
      const manifest = artifacts.getManifest()
      const entry = (manifest.pages || []).find((p) => p.url === input.pageUrl)
      if (!entry) return { error: `Page not captured: ${input.pageUrl}` }
      const viewport = input.viewport === 'mobile' ? 'mobile' : 'desktop'
      const rel = viewport === 'mobile' ? entry.mobileScreenshot : entry.desktopScreenshot
      if (!rel) return { error: `No ${viewport} screenshot captured for ${input.pageUrl}` }
      const abs = path.join(session.storagePath, rel)
      if (!fs.existsSync(abs)) return { error: `Screenshot file missing: ${rel}` }
      const buf = fs.readFileSync(abs)
      if (buf.length > MAX_SCREENSHOT_BYTES) {
        return {
          error: `Screenshot too large (${buf.length} bytes). Ask about a smaller region or the DOM instead.`,
        }
      }
      const constrained = constrainImageForAnthropic(buf, sniffMediaType(buf, rel))
      return {
        __imageContent: {
          type: 'image',
          source: {
            type: 'base64',
            media_type: constrained.mediaType,
            data: constrained.buf.toString('base64'),
          },
        },
        pageUrl: input.pageUrl,
        viewport,
      }
    }
    case 'search_wcag': {
      const query = String(input.query || '').trim()
      if (!query) return { error: 'search_wcag requires a non-empty query' }
      const topK = Math.min(Math.max(Number(input.top_k) || 5, 1), 10)
      const dir = getWcagIndexPath()
      if (!dir) {
        return { error: 'WCAG index not available in this build' }
      }
      try {
        return searchWcag({ dir, query, topK })
      } catch (e) {
        log(`search_wcag failed: ${e && e.message ? e.message : String(e)}`)
        return { error: `WCAG search failed: ${e && e.message ? e.message : 'unknown'}` }
      }
    }
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ---- Anthropic SSE streaming with tool-use loop ----

async function streamAnthropicTurn({ session, mainWindow, sessionId }) {
  const { cfg, systemPrompt, messages } = session
  const abort = new AbortController()
  session.abort = abort

  const body = {
    model: cfg.model,
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
    tools: TOOL_SCHEMAS,
    stream: true,
  }

  const resp = await axios.post(`${cfg.baseURL}/messages`, body, {
    signal: abort.signal,
    responseType: 'stream',
    timeout: 0,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      authorization: `Bearer ${cfg.apiKey}`,
      'anthropic-version': ANTHROPIC_VERSION,
      accept: 'text/event-stream',
      ...cfg.headers,
    },
    validateStatus: () => true,
  })

  if (resp.status >= 400) {
    let errText = ''
    for await (const chunk of resp.data) errText += chunk.toString('utf8')
    throw new Error(`Anthropic ${resp.status}: ${errText.slice(0, 500)}`)
  }

  const blocks = [] // accumulated content blocks for the assistant message
  let stopReason = null
  const send = (channel, payload) => mainWindow.webContents.send(channel, payload)

  let sseBuffer = ''
  for await (const chunk of resp.data) {
    sseBuffer += chunk.toString('utf8')
    let sep
    // eslint-disable-next-line no-cond-assign
    while ((sep = sseBuffer.indexOf('\n\n')) !== -1) {
      const event = sseBuffer.slice(0, sep)
      sseBuffer = sseBuffer.slice(sep + 2)
      // Each event has "event: X\ndata: {...}"
      const dataLine = event.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      let payload
      try {
        payload = JSON.parse(dataLine.slice(5).trim())
      } catch (_) {
        continue
      }
      switch (payload.type) {
        case 'content_block_start': {
          const idx = payload.index
          const cb = payload.content_block
          if (cb.type === 'text') {
            blocks[idx] = { type: 'text', text: '' }
          } else if (cb.type === 'tool_use') {
            blocks[idx] = {
              type: 'tool_use',
              id: cb.id,
              name: cb.name,
              input: {},
              _inputJson: '',
            }
            send('llmChat:toolCall', { sessionId, name: cb.name, id: cb.id, status: 'start' })
          }
          break
        }
        case 'content_block_delta': {
          const idx = payload.index
          const delta = payload.delta
          if (!blocks[idx]) break
          if (delta.type === 'text_delta') {
            blocks[idx].text += delta.text
            send('llmChat:chunk', { sessionId, text: delta.text })
          } else if (delta.type === 'input_json_delta') {
            blocks[idx]._inputJson = (blocks[idx]._inputJson || '') + (delta.partial_json || '')
          }
          break
        }
        case 'content_block_stop': {
          const idx = payload.index
          const b = blocks[idx]
          if (b?.type === 'tool_use' && b._inputJson) {
            try {
              b.input = JSON.parse(b._inputJson)
            } catch (_) {
              b.input = {}
            }
            delete b._inputJson
            send('llmChat:toolCall', {
              sessionId,
              name: b.name,
              id: b.id,
              input: b.input,
              status: 'ready',
            })
          }
          break
        }
        case 'message_delta': {
          if (payload.delta?.stop_reason) stopReason = payload.delta.stop_reason
          break
        }
        case 'message_stop':
          break
        default:
          break
      }
    }
  }

  // Strip any internal fields, drop empties.
  const cleanBlocks = blocks
    .filter(Boolean)
    .map((b) => {
      if (b.type === 'tool_use') {
        const { _inputJson, ...rest } = b
        return rest
      }
      return b
    })

  return { blocks: cleanBlocks, stopReason }
}

async function runChatLoop({ session, mainWindow, sessionId }) {
  const send = (channel, payload) => mainWindow.webContents.send(channel, payload)
  for (let hop = 0; hop < 10; hop++) {
    const { blocks, stopReason } = await streamAnthropicTurn({ session, mainWindow, sessionId })
    session.messages.push({ role: 'assistant', content: blocks })
    if (stopReason !== 'tool_use') return

    const toolUses = blocks.filter((b) => b.type === 'tool_use')
    const toolResults = []
    for (const tu of toolUses) {
      let content
      try {
        // Most tool cases return synchronously; search_wcag returns a Promise
        // (Vectra + embedding are async). `await` on a non-Promise is a no-op,
        // so this is safe for every branch.
        const raw = await runTool(session, tu.name, tu.input)
        // Screenshot returns a special marker with an image block.
        if (raw && raw.__imageContent) {
          content = [
            raw.__imageContent,
            {
              type: 'text',
              text: JSON.stringify(
                { pageUrl: raw.pageUrl, viewport: raw.viewport, note: 'image attached above' },
                null,
                0
              ),
            },
          ]
          send('llmChat:toolCall', {
            sessionId,
            id: tu.id,
            name: tu.name,
            status: 'done',
            summary: `screenshot: ${raw.pageUrl} (${raw.viewport})`,
            result: JSON.stringify(
              { pageUrl: raw.pageUrl, viewport: raw.viewport, note: 'image attached to conversation' },
              null,
              2
            ),
          })
        } else if (raw && Array.isArray(raw.__attachments) && raw.__attachments.length > 0) {
          // Element screenshots — one image block per occurrence for the LLM,
          // plus attachment events for the renderer so the user can see them.
          content = []
          for (const att of raw.__attachments) {
            content.push({
              type: 'text',
              text: `Element screenshot for occurrence #${att.occurrenceIndex} (${att.url}${
                att.xpath ? ` @ ${att.xpath}` : ''
              }):`,
            })
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: att.mediaType,
                data: att.base64,
              },
            })
            send('llmChat:attachment', {
              sessionId,
              toolCallId: tu.id,
              occurrenceIndex: att.occurrenceIndex,
              url: att.url,
              pageTitle: att.pageTitle,
              xpath: att.xpath,
              dataUri: `data:${att.mediaType};base64,${att.base64}`,
            })
          }
          const text = JSON.stringify(raw.payload, null, 0)
          content.push({
            type: 'text',
            text: text.length > 40_000 ? text.slice(0, 40_000) + '\n…[truncated]' : text,
          })
          send('llmChat:toolCall', {
            sessionId,
            id: tu.id,
            name: tu.name,
            status: 'done',
            summary: `${tu.name}: ${raw.__attachments.length} screenshot(s) attached`,
            result: JSON.stringify(raw.payload, null, 2),
          })
        } else {
          const text = JSON.stringify(raw, null, 0)
          content = text.length > 40_000 ? text.slice(0, 40_000) + '\n…[truncated]' : text
          const pretty = JSON.stringify(raw, null, 2)
          send('llmChat:toolCall', {
            sessionId,
            id: tu.id,
            name: tu.name,
            status: 'done',
            summary: `${tu.name} returned ${content.length} bytes`,
            result: pretty.length > 40_000 ? pretty.slice(0, 40_000) + '\n…[truncated]' : pretty,
          })
        }
      } catch (e) {
        content = JSON.stringify({ error: e.message })
        send('llmChat:toolCall', {
          sessionId,
          id: tu.id,
          name: tu.name,
          status: 'error',
          summary: e.message,
          error: e.message,
        })
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content,
      })
    }
    session.messages.push({ role: 'user', content: toolResults })
  }
  warn('tool-use loop exceeded 10 hops; stopping')
}

// ---- IPC handlers ----

function init({ mainWindow, getResultsFolderPath }) {
  // Occurrence-browser feed. Same source data as the get_finding_detail tool,
  // but skips the tool loop and inlines per-occurrence screenshots as data
  // URIs so the renderer can page through them without further IPC.
  ipcMain.handle('llmChat:findingDetail', async (_e, { sessionId, category, ruleId }) => {
    try {
      const session = sessions.get(sessionId)
      if (!session) return { ok: false, error: 'Session not found' }
      const items = session.artifacts.getScanItems() || {}
      const rules = scanItemsRules(items, category)
      const match = rules.find((r) => (r.rule ?? r.ruleId) === ruleId)
      if (!match) return { ok: false, error: `Rule not found: ${category}/${ruleId}` }

      const pagesAffected = Array.isArray(match.pagesAffected) ? match.pagesAffected : []
      const MAX_OCCURRENCES = 100
      const SCREENSHOT_BUDGET = 20 * 1024 * 1024
      let screenshotBudget = SCREENSHOT_BUDGET

      const occurrences = []
      const totalRaw = pagesAffected.reduce((n, p) => n + (p.items?.length || 0), 0)
      outer: for (const p of pagesAffected) {
        for (const it of p.items || []) {
          if (occurrences.length >= MAX_OCCURRENCES) break outer
          let screenshotDataUri = null
          const rel = it.screenshotPath
          if (rel) {
            const abs = path.join(session.storagePath, rel)
            try {
              const st = fs.statSync(abs)
              if (
                st.isFile() &&
                st.size > 0 &&
                st.size <= MAX_ELEM_SCREENSHOT_BYTES &&
                st.size <= screenshotBudget
              ) {
                const buf = fs.readFileSync(abs)
                const mediaType = sniffMediaType(buf, rel)
                screenshotDataUri = `data:${mediaType};base64,${buf.toString('base64')}`
                screenshotBudget -= st.size
              }
            } catch (_) {}
          }
          occurrences.push({
            url: p.url,
            pageTitle: p.pageTitle,
            html: it.html,
            message: it.message,
            xpath: it.xpath,
            screenshotDataUri,
          })
        }
      }

      return {
        ok: true,
        rule: match.rule ?? match.ruleId,
        category,
        description: match.description,
        axeImpact: match.axeImpact,
        conformance: formatWcagConformance(match.conformance ?? match.wcagConformance),
        helpUrl: match.helpUrl,
        totalOccurrences: totalRaw,
        occurrences,
        truncated: totalRaw > occurrences.length,
      }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('llmChat:providers', async () => {
    let anthropicAvailable = false
    let anthropicError = null
    try {
      const cfg = loadLLMConfig()
      anthropicAvailable = cfg.provider === 'anthropic'
      if (!anthropicAvailable) {
        anthropicError = `Configured provider is ${cfg.provider}, not anthropic.`
      }
    } catch (e) {
      anthropicError = e.message
    }
    return { anthropic: { available: anthropicAvailable, error: anthropicError } }
  })

  ipcMain.handle('llmChat:start', async (_event, { sessionId, scanId, provider }) => {
    try {
      if (!sessionId) throw new Error('Missing sessionId')
      if (!scanId) throw new Error('Missing scanId')
      const chosenProvider = provider === 'gemma' ? 'gemma' : 'anthropic'
      const storagePath = getResultsFolderPath(scanId)
      if (!storagePath || !fs.existsSync(storagePath)) {
        return { ok: false, error: `Scan folder not found for scanId=${scanId}` }
      }
      const artifacts = loadArtifacts(storagePath)
      if (!artifacts.scanData) {
        return {
          ok: false,
          error:
            'Scan JSON output not found. Confirm the scan ran with -g yes (LLM analysis mode enables this automatically).',
        }
      }
      const summary = computeSummary(artifacts)
      // The full findings index is ~30 KB, useful as Anthropic prompt-cache
      // pre-warming. Local Gemma has an ~8 K token context by default, so we
      // trim it and let the model fetch rule details via list_findings /
      // get_finding_detail on demand.
      const promptSummary =
        chosenProvider === 'gemma' ? { ...summary, findingsIndex: null } : summary
      const systemPrompt = buildSystemPrompt({ summary: promptSummary })
      // Dispose any prior session state for this id (e.g. provider switch).
      const prior = sessions.get(sessionId)
      if (prior) disposeGemmaSession(prior)
      sessions.set(sessionId, {
        scanId,
        provider: chosenProvider,
        storagePath,
        artifacts,
        summary,
        systemPrompt,
        cfg: null, // lazy — only load when the user actually sends a message
        messages: [],
        gemma: null,
        abort: null,
      })
      log(`session ${sessionId} started for scanId=${scanId} provider=${chosenProvider}`)
      return { ok: true, summary, provider: chosenProvider }
    } catch (e) {
      warn(`start failed: ${e.message}`)
      return { ok: false, error: e.message }
    }
  })

  ipcMain.on('llmChat:send', async (_event, { sessionId, userMessage, attachments }) => {
    const session = sessions.get(sessionId)
    if (!session) {
      mainWindow.webContents.send('llmChat:error', {
        sessionId,
        message: 'Session not found. Please reload the chat.',
      })
      return
    }
    // Split each attachment's data URI into mediaType + base64 once, so both
    // providers can consume the shared shape without re-parsing.
    const parsedAttachments = Array.isArray(attachments)
      ? attachments
          .map((a) => {
            if (!a?.dataUri || typeof a.dataUri !== 'string') return null
            const m = a.dataUri.match(/^data:([^;]+);base64,(.*)$/)
            if (!m) return null
            return {
              mediaType: m[1],
              base64: m[2],
              occurrenceIndex: a.occurrenceIndex,
              pageTitle: a.pageTitle,
              url: a.url,
              xpath: a.xpath,
              kind: a.kind || 'user-attachment',
            }
          })
          .filter(Boolean)
      : []
    try {
      if (session.provider === 'gemma') {
        await streamGemmaChat({
          session,
          mainWindow,
          sessionId,
          userMessage,
          attachments: parsedAttachments,
          runTool,
          toolSchemas: TOOL_SCHEMAS,
        })
      } else {
        if (!session.cfg) {
          session.cfg = loadLLMConfig()
          if (session.cfg.provider !== 'anthropic') {
            throw new Error(
              'Tool use is only supported for Anthropic providers in this version. Set ANTHROPIC_API_KEY or configure ~/.claude/settings.json.'
            )
          }
          log(`session ${sessionId} using model ${session.cfg.model} at ${session.cfg.baseURL}`)
        }
        // Anthropic accepts a content array on user messages. Prepend image
        // blocks so the model sees the screenshot alongside the question.
        // (Gemma can't do this today — see llmGemma.js for the tracker-issue
        // reference and the reasoning behind leaving Gemma image-blind.)
        if (parsedAttachments.length > 0) {
          const content = []
          for (const att of parsedAttachments) {
            const constrained = constrainImageForAnthropic(
              Buffer.from(att.base64, 'base64'),
              att.mediaType,
            )
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: constrained.mediaType,
                data: constrained.buf.toString('base64'),
              },
            })
          }
          content.push({ type: 'text', text: userMessage })
          session.messages.push({ role: 'user', content })
        } else {
          session.messages.push({ role: 'user', content: userMessage })
        }
        await runChatLoop({ session, mainWindow, sessionId })
      }
      mainWindow.webContents.send('llmChat:done', { sessionId })
    } catch (e) {
      warn(`chat error: ${e.message}`)
      mainWindow.webContents.send('llmChat:error', { sessionId, message: e.message })
    } finally {
      session.abort = null
    }
  })

  ipcMain.on('llmChat:abort', (_event, sessionId) => {
    const session = sessions.get(sessionId)
    if (session?.abort) {
      log(`aborting session ${sessionId}`)
      session.abort.abort()
    }
  })

  ipcMain.handle('llmChat:preloadModel', async () => {
    try {
      await ensureGemmaModel()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.on('llmChat:dispose', (_event, sessionId) => {
    const session = sessions.get(sessionId)
    if (session) {
      log(`disposing session ${sessionId}`)
      if (session.abort) session.abort.abort()
      disposeGemmaSession(session)
      sessions.delete(sessionId)
    }
    // unloadGemmaModel()
  })
}

module.exports = { init }
