// System prompt template + Anthropic tool schemas for the LLM analysis chat.
// Kept in public/electron so the main process doesn't reach across into src/.

function buildSystemPrompt({ summary }) {
  const {
    siteName,
    urlScanned,
    startTime,
    totalPagesScanned = 0,
    totalPagesNotScanned = 0,
    wcagPassPercentage = null,
    wcagChecksPassed = null,
    wcagChecksTotal = null,
    mustFixRules = 0,
    mustFixOccurrences = 0,
    goodToFixRules = 0,
    goodToFixOccurrences = 0,
    needsReviewRules = 0,
    needsReviewOccurrences = 0,
    topRules = [],
    topPages = [],
    findingsIndex = null,
  } = summary || {}

  const topRulesLines = topRules
    .map(
      (r, i) =>
        `${i + 1}. ${r.rule} — ${r.description || ''} (${r.totalItems ?? '?'} occurrences, WCAG ${(r.conformance || []).join(', ')})`
    )
    .join('\n')

  const topPagesLines = topPages
    .map(
      (p, i) =>
        `${i + 1}. ${p.pageTitle || p.url} — ${p.totalIssues ?? p.totalOccurrencesFailedIncludingNeedsReview ?? '?'} issues`
    )
    .join('\n')

  const indexBlock = findingsIndex
    ? `\n### Full findings index\n${JSON.stringify(findingsIndex, null, 0)}\n`
    : ''

  return `You are an accessibility triage expert reviewing an Oobee accessibility scan of ${siteName || urlScanned || 'the target site'} (started ${startTime || 'recently'}).

Oobee categorises each finding as:
- \`mustFix\`  — definite WCAG A/AA violation
- \`goodToFix\` — best-practice issue that is not strictly a WCAG failure
- \`needsReview\` — automated tooling could not be certain; a human should verify

You have the scan overview and a compact index of every finding. You do NOT have every finding's full detail or every page's HTML — call the provided tools when you need element-level HTML, per-page issue lists, DOMs, or full-page screenshots. Do not fabricate rule ids, WCAG clauses, or affected elements — if unsure, call a tool.

**WCAG citation rule (strict):** Each rule below lists its authoritative WCAG references in the \`WCAG …\` column. When you discuss a rule, cite ONLY the WCAG success criteria listed for that rule — do not add related-looking ones from your general knowledge (e.g. do not add SC 2.4.4 "Link Purpose" to a rule whose listed WCAG is 4.1.2). If a rule has no WCAG references listed, say "no WCAG mapping recorded" rather than inventing one. If you need conformance for a rule not covered by the top-rules list, call \`get_finding_detail\` first — its return value has an authoritative \`conformance\` array.

When you propose a fix, cite the specific WCAG success criterion using the exact identifier from the authoritative list (e.g. "WCAG 4.1.2 Name, Role, Value"). Prefer concrete, copy-pasteable code snippets over general advice. Keep answers scannable — short paragraphs, bullet lists, and code fences. Use markdown.

### Scan overview
- URL: ${urlScanned || '—'}
- Pages scanned: ${totalPagesScanned} (${totalPagesNotScanned} skipped)
- WCAG AA automated score: ${
    Number.isFinite(wcagChecksPassed) && Number.isFinite(wcagChecksTotal)
      ? `${wcagChecksPassed} / ${wcagChecksTotal} checks passed`
      : typeof wcagPassPercentage === 'number'
        ? `${wcagPassPercentage.toFixed(1)}% pass`
        : 'unknown'
  }
- Must-fix: ${mustFixRules} rules / ${mustFixOccurrences} occurrences
- Good-to-fix: ${goodToFixRules} rules / ${goodToFixOccurrences} occurrences
- Needs review: ${needsReviewRules} rules / ${needsReviewOccurrences} occurrences

### Top violated rules (must-fix, by occurrence)
${topRulesLines || '(none)'}

### Top pages by issue count
${topPagesLines || '(none)'}
${indexBlock}`
}

const TOOL_SCHEMAS = [
  {
    name: 'list_findings',
    description:
      'List findings from the scan, optionally filtered by category and/or ruleId. Returns a slim summary array; call get_finding_detail for element-level HTML.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['mustFix', 'goodToFix', 'needsReview'] },
        ruleId: { type: 'string' },
        limit: { type: 'integer', default: 20 },
        offset: { type: 'integer', default: 0 },
      },
    },
  },
  {
    name: 'get_finding_detail',
    description:
      'Return the full detail for one rule, including affected element HTML, xpath, and per-occurrence messages. Element list may be truncated for very frequent rules.',
    input_schema: {
      type: 'object',
      required: ['ruleId', 'category'],
      properties: {
        ruleId: { type: 'string' },
        category: { type: 'string', enum: ['mustFix', 'goodToFix', 'needsReview'] },
        limit: { type: 'integer', default: 20 },
      },
    },
  },
  {
    name: 'list_pages',
    description: 'List pages that were scanned with per-page issue counts.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 50 },
        offset: { type: 'integer', default: 0 },
      },
    },
  },
  {
    name: 'get_page_detail',
    description: 'Get all findings on a specific scanned page.',
    input_schema: {
      type: 'object',
      required: ['pageUrl'],
      properties: { pageUrl: { type: 'string' } },
    },
  },
  {
    name: 'list_page_captures',
    description:
      'List which scanned pages have DOM, screenshot, and computed-style captures available (desktop / mobile). Useful as a pre-flight before get_page_dom / get_page_css / get_page_computed_styles.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_page_dom',
    description:
      'Return the captured HTML content for a scanned page. Content is truncated at ~30 KB — if truncated, ask a more specific follow-up.',
    input_schema: {
      type: 'object',
      required: ['pageUrl'],
      properties: {
        pageUrl: { type: 'string' },
        viewport: { type: 'string', enum: ['desktop', 'mobile'], default: 'desktop' },
      },
    },
  },
  {
    name: 'get_page_computed_styles',
    description:
      'Return the browser-computed styles (color, background-color, background-image, font-size, opacity, outline, border, etc.) for elements on a scanned page. Use this for color-contrast, focus-visible, and any rule where you need the actually-applied CSS values rather than just the inline styles. Requires a selector — pass the same selector the finding\'s xpath field contains (axe reports CSS selectors under the "xpath" name). If the file is missing, the scan was run without OOBEE_SAVE_COMPUTED_STYLES=1 — fall back to get_page_css. Do NOT call this without a selector; the whole file can be thousands of elements.',
    input_schema: {
      type: 'object',
      required: ['pageUrl', 'selector'],
      properties: {
        pageUrl: { type: 'string' },
        selector: {
          type: 'string',
          description:
            'CSS selector for the element you want computed styles for. Accepts axe-target formats like ".warning2-text", "#foo", ".parent > .child".',
        },
        viewport: { type: 'string', enum: ['desktop', 'mobile'], default: 'desktop' },
        limit: { type: 'integer', default: 5 },
      },
    },
  },
  {
    name: 'get_page_css',
    description:
      'Return the inline <style> block contents and the list of external stylesheet URLs referenced by a scanned page. Use this for CSS-dependent rules like color-contrast or focus-visible. External stylesheet content is NOT captured by the scan — if the failing rule is not present in the inline styles, tell the user the styles live in an external file that was not captured, and name the likely files from externalStylesheetUrls.',
    input_schema: {
      type: 'object',
      required: ['pageUrl'],
      properties: {
        pageUrl: { type: 'string' },
        viewport: { type: 'string', enum: ['desktop', 'mobile'], default: 'desktop' },
      },
    },
  },
  {
    name: 'get_page_screenshot',
    description:
      'Return the full-page screenshot of a scanned page as an image. Use this to reason about visual issues (color contrast, layout, focus order).',
    input_schema: {
      type: 'object',
      required: ['pageUrl'],
      properties: {
        pageUrl: { type: 'string' },
        viewport: { type: 'string', enum: ['desktop', 'mobile'], default: 'desktop' },
      },
    },
  },
]

module.exports = { buildSystemPrompt, TOOL_SCHEMAS }
