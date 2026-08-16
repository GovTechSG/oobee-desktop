// System prompt template + Anthropic tool schemas for the LLM analysis chat.
// Kept in public/electron so the main process doesn't reach across into src/.

function buildSystemPrompt({ summary }) {
  const {
    siteName,
    urlScanned,
    startTime,
    viewport,
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

  // Oobee's viewport selector (see src/common/constants.js viewportTypes) yields
  // one of four display strings: "Desktop", "Mobile", a Playwright device name
  // (e.g. "iPhone 11", "Pixel 5", "Samsung Galaxy S23"), or a numeric custom
  // width. Only "Desktop" maps to the desktop capture slot; every other value
  // populates the mobile capture slot on the scan artefacts.
  //
  // Concrete viewport widths (from Oobee CLI + Playwright device descriptors):
  //   - "Desktop"          → 1280 × 720 (Playwright "Desktop Chrome"), isMobile=false
  //   - "Mobile"           → 414 × 715 (Playwright "iPhone 11"), isMobile=true, DPR=2
  //   - "Samsung Galaxy S9+" → Playwright "Galaxy S9+" (360 × 740), isMobile=true
  //   - Other device names → their Playwright profile
  //   - Custom width       → { width, height: 720 }, isMobile=false
  //
  // Both key Tailwind breakpoints (`md:` = 768 px, `lg:` = 1024 px) sit ABOVE
  // 414 px, so on a Mobile scan neither responsive-prefix set applies.
  const viewportRaw = typeof viewport === 'string' ? viewport.trim() : ''
  const viewportLower = viewportRaw.toLowerCase()
  const isDesktopScan = viewportLower === 'desktop'
  const isNarrowScan = viewportRaw !== '' && !isDesktopScan
  const toolViewport = isDesktopScan ? 'desktop' : 'mobile'
  // Known-width detail for common presets. Improves the model's ability to
  // reason about media-query cut-offs (e.g. "does md:h-10 apply here?").
  let widthDetail = ''
  if (isDesktopScan) {
    widthDetail = '1280 × 720 CSS px, Playwright "Desktop Chrome" profile, `isMobile=false`'
  } else if (viewportLower === 'mobile') {
    widthDetail = '414 × 715 CSS px, Playwright "iPhone 11" profile, `isMobile=true`, DPR=2'
  } else if (viewportLower === 'samsung galaxy s9+') {
    widthDetail = '360 × 740 CSS px, Playwright "Galaxy S9+" profile, `isMobile=true`'
  } else if (/^\d+$/.test(viewportRaw)) {
    widthDetail = `${viewportRaw} × 720 CSS px, Chrome UA, \`isMobile=false\` (custom width)`
  }
  const narrowHint = `narrow — responsive-prefix classes like Tailwind \`md:*\` (≥ 768 px) and \`lg:*\` (≥ 1024 px), and desktop-only media-query rules, DO NOT apply here; the geometry axe measured is the mobile-rendered geometry, not the desktop one`
  const scanViewportLine = viewportRaw
    ? `- Scan viewport: ${viewportRaw}${widthDetail ? ` — ${widthDetail}` : ''}${isNarrowScan ? ` (${narrowHint})` : ''}`
    : null
  const viewportRuleText = viewportRaw
    ? `**Viewport rule:** This scan was run at the **${viewportRaw}** viewport${widthDetail ? ` (${widthDetail})` : ''}${isNarrowScan ? ' — a narrow one where responsive-prefix classes (Tailwind `md:*` ≥ 768 px, `lg:*` ≥ 1024 px) and desktop-only media-query rules DO NOT apply' : ''}. Every geometry / layout finding (target size, contrast on responsive layouts, focus-visible on responsive controls) reflects THIS viewport, not the desktop DevTools view the developer is looking at. When you inspect computed styles, DOM, or screenshots, default to \`viewport="${toolViewport}"\` to match what the scanner actually saw${isNarrowScan ? ' (only the mobile capture slot is populated for non-desktop scans; \`viewport="desktop"\` will typically return "not captured")' : ''}. Always name the viewport in your dimension citations.`
    : `**Viewport rule:** The scan viewport is unknown. Non-desktop scans run at a narrow viewport where responsive-prefix classes (Tailwind \`md:*\` ≥ 768 px, \`lg:*\` ≥ 1024 px; media-query rules) do NOT apply. Before assuming geometry, call \`list_page_captures\` to see which viewport slot (desktop vs. mobile) actually has data. When a rule depends on rendered geometry, always report the viewport you measured at.`

  return `You are an accessibility triage expert reviewing an Oobee accessibility scan of ${siteName || urlScanned || 'the target site'} (started ${startTime || 'recently'}).

Oobee categorises each finding as:
- \`mustFix\`  — definite WCAG A/AA violation
- \`goodToFix\` — best-practice issue that is not strictly a WCAG failure
- \`needsReview\` — automated tooling could not be certain; a human should verify

You have the scan overview and a compact index of every finding. You do NOT have every finding's full detail or every page's HTML — call the provided tools when you need element-level HTML, per-page issue lists, DOMs, or full-page screenshots. For the exact wording of a WCAG success criterion or a WCAG technique/failure document, call \`search_wcag\` rather than answering from your own knowledge. Do not fabricate rule ids, WCAG clauses, or affected elements — if unsure, call a tool.

**WCAG citation rule (strict):** Each rule below lists its authoritative WCAG references in the \`WCAG …\` column. When you discuss a rule, cite ONLY the WCAG success criteria listed for that rule — do not add related-looking ones from your general knowledge (e.g. do not add SC 2.4.4 "Link Purpose" to a rule whose listed WCAG is 4.1.2). If a rule has no WCAG references listed, say "no WCAG mapping recorded" rather than inventing one. If you need conformance for a rule not covered by the top-rules list, call \`get_finding_detail\` first — its return value has an authoritative \`conformance\` array. If the user asks a general question about a success criterion or technique (not tied to a specific rule in this scan), call \`search_wcag\` before answering and ground your response in the returned snippets — do not answer from memory alone.

When you propose a fix, cite the specific WCAG success criterion using the exact identifier from the authoritative list (e.g. "WCAG 4.1.2 Name, Role, Value"). Prefer concrete, copy-pasteable code snippets over general advice. Keep answers scannable — short paragraphs, bullet lists, and code fences. Use markdown.

**Evidence rule (verify, don't speculate):** Never fabricate an explanation to reconcile a measurement discrepancy. If a computed value contradicts the user's claim, the attached screenshot, or common sense (e.g. a visibly 32 px pill reported as 19 px), do NOT invent a cause like "the mobile viewport collapses it" or "hydration hasn't run yet" from your general knowledge. Instead: (a) re-check by calling \`get_page_computed_styles\` for BOTH viewports (\`desktop\` and \`mobile\`); (b) call \`get_page_dom\` with the mobile viewport to confirm which classes are actually rendered there; (c) call \`get_page_screenshot\` with \`viewport="mobile"\` and describe what you actually see. If after these checks the discrepancy is still unexplained, say so plainly and ask the user for guidance — do not guess.

${viewportRuleText}

**Recommendation rule (avoid over-prescription):** Recommend the *minimum* change that satisfies the SC — do not anchor on the design's current value or default to the largest/safest fix.

1. **Cite the SC threshold, not the current value.** If a target is 32 px and the SC minimum is 24 px, the fix target is 24 px, not 32 px. If contrast is 4.2:1 and the SC floor is 4.5:1, the fix is 4.5:1 or slightly above — not 7:1. Over-prescription is a real cost: it locks the design out of alternatives and often makes the recommendation feel arbitrary.
2. **Enumerate the full solution space when more than one direction is valid.** Threshold SCs (target size, contrast, font size, spacing, timing) usually admit multiple valid fixes:
   - *Additive*: enlarge / darken / lengthen to satisfy directly.
   - *Subtractive*: shrink / soften the current value toward the threshold — sometimes better UX (more compact layout, less visual noise).
   - *Exemption*: some SCs have alternative conditions (e.g. WCAG 2.5.8 lets an undersized target pass if spacing compensates; 1.4.3 exempts large text at 3:1). Surface these as co-equal options, not footnotes.
3. **Prefer subtractive/removal fixes over additive scaffolding when both work.** For structural rules (roles, labels, tabindex, ARIA), removing the barrier (delete the custom control, revert to native semantics, drop the redundant \`role\`) is often more robust than layering ARIA on top. Default to "make the problem disappear" before "add attributes to describe the problem".
4. **Do not conflate "current design" with "correct minimum".** When the failing element has a wrapper that is smaller than an inner visual (e.g. \`<a>\` collapsed to 19 px around a 32 px pill), fix the wrapper to the SC threshold — do not automatically match the wrapper to the visual.

### Scan overview
- URL: ${urlScanned || '—'}${scanViewportLine ? `\n${scanViewportLine}` : ''}
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
      'Return the captured HTML content for a scanned page. Content is truncated at ~30 KB — if truncated, ask a more specific follow-up. Pass viewport="mobile" to see the DOM AS THE SCANNER SAW IT at a narrow viewport — this is the authoritative source for whether responsive-prefix classes (Tailwind `md:*`, `lg:*`) or media-query rules actually applied. For any geometry-dependent finding (target-size, focus-visible, contrast on responsive layouts), call this with viewport="mobile" to confirm which classes are rendered — do NOT infer viewport behaviour from the authored class list in the finding.',
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
    name: 'get_element_context',
    description:
      'Return the surrounding HTML (an ancestor element\'s outerHTML) for a specific failing element on a scanned page. Use this to verify context around an accessibility violation — e.g. an unlabeled form control whose neighbouring sibling is actually a <label>, or a target whose closest labelling ancestor already has an id you could reference via aria-labelledby. Requires a selector; pass the same CSS selector the finding\'s xpath field contains (axe reports CSS selectors under the "xpath" name). Walks up ancestorDepth levels (default 2, capped at 5) from the target and returns the outerHTML of that ancestor. Do NOT invent new ids on siblings when reasoning about a fix — only reference ids that already appear in the returned ancestorHtml. Output is capped at ~10 KB.',
    input_schema: {
      type: 'object',
      required: ['pageUrl', 'selector'],
      properties: {
        pageUrl: { type: 'string' },
        selector: {
          type: 'string',
          description:
            'CSS selector for the target element. Accepts axe-target formats like ".warning2-text", "#foo", ".parent > .child". Same value the finding reports under the "xpath" field.',
        },
        ancestorDepth: {
          type: 'integer',
          default: 2,
          description:
            'How many ancestor levels above the target to include. 1 = parent, 2 = grandparent, capped at 5. Use 2 by default; go higher only when you need larger neighbourhood context (e.g. containing form or landmark).',
        },
        viewport: { type: 'string', enum: ['desktop', 'mobile'], default: 'desktop' },
      },
    },
  },
  {
    name: 'get_page_computed_styles',
    description:
      'Return the browser-computed styles for elements on a scanned page. The returned object contains both APPEARANCE properties (color, background-color, background-image, font-size, line-height, opacity, outline, border) AND LAYOUT properties (height, width, min-height, min-width, max-height, max-width, padding-top, padding-bottom, padding-left, padding-right, margin-top, margin-bottom, box-sizing, display, position). Use this for color-contrast, focus-visible, and target-size — any rule where you need the actually-applied CSS values rather than just the inline styles. For target-size / geometry rules, read the LAYOUT properties (never report line-height in place of height — a 24px line-height on a 16px font yields an inline-box height near 19px, a common source of confusion) and resolve rem/em/% units to pixels using a 16px base font-size before comparing to the 24px threshold. Requires a selector — pass the same selector the finding\'s xpath field contains (axe reports CSS selectors under the "xpath" name). If the file is missing, the scan was run without OOBEE_SAVE_COMPUTED_STYLES=1 — fall back to get_page_css. Do NOT call this without a selector; the whole file can be thousands of elements.',
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
  {
    name: 'search_wcag',
    description:
      'Search the local WCAG 2.x Understanding and Techniques corpus for authoritative text. Call this when you need the exact wording of a success criterion, a technique document (G-, H-, F-, ARIA-, C-numbered), or a failure condition — and whenever the user asks about WCAG guidance not tied to a specific rule in this scan. Example queries: "2.4.4 link purpose", "G54 skip navigation", "target size minimum 2.5.5", "focus visible technique". Returns a small set of ranked snippets with title, section, URL and score. If the first hit is too generic, call again with a refined query.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Keyword or phrase, ideally 2–10 words. Dotted SC numbers like "2.4.4" and technique ids like "G54" are supported.',
        },
        top_k: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
      },
    },
  },
]

module.exports = { buildSystemPrompt, TOOL_SCHEMAS }
