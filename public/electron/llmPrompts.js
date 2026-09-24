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
  // width.
  //
  // Both capture slots are always populated, but the slot names only describe
  // the scan's own viewport when it is "Desktop": oobee captures the `desktop`
  // slot at whatever viewport the scan was configured for, then switches to a
  // fixed 414 × 715 for the `mobile` slot. So on a Mobile scan both slots hold
  // narrow geometry and the slot label is not a measurement. The payload's
  // `viewportSize` is what the model should cite.
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
    ? `**Viewport rule:** This scan was run at the **${viewportRaw}** viewport${widthDetail ? ` (${widthDetail})` : ''}${isNarrowScan ? ' — a narrow one where responsive-prefix classes (Tailwind `md:*` ≥ 768 px, `lg:*` ≥ 1024 px) and desktop-only media-query rules DO NOT apply' : ''}. Every geometry / layout finding (target size, contrast on responsive layouts, focus-visible on responsive controls) reflects THIS viewport, not the desktop DevTools view the developer is looking at. When you inspect computed styles, DOM, or screenshots, default to \`viewport="${toolViewport}"\` to match what the scanner actually saw${isNarrowScan ? ' — and note that the `desktop` capture slot is NOT desktop geometry on this scan: oobee captures that slot at the scan\'s own configured viewport before re-capturing at a fixed 414 × 715, so BOTH slots hold narrow-viewport data. The slot name is a label, not a measurement; the `viewportSize` field returned by `get_page_computed_styles` is authoritative for the width geometry was measured at' : ''}. Always name the viewport, and its pixel size, in your dimension citations.`
    : `**Viewport rule:** The scan viewport is unknown. Non-desktop scans run at a narrow viewport where responsive-prefix classes (Tailwind \`md:*\` ≥ 768 px, \`lg:*\` ≥ 1024 px; media-query rules) do NOT apply. Before assuming geometry, call \`list_page_captures\` to see which viewport slot (desktop vs. mobile) actually has data. When a rule depends on rendered geometry, always report the viewport you measured at.`

  return `You are an accessibility triage expert reviewing an Oobee accessibility scan of ${siteName || urlScanned || 'the target site'} (started ${startTime || 'recently'}).

Oobee categorises each finding as:
- \`mustFix\`  — definite WCAG A/AA violation
- \`goodToFix\` — best-practice issue that is not strictly a WCAG failure
- \`needsReview\` — automated tooling could not be certain; a human should verify

You have the scan overview and a compact index of every finding. You do NOT have every finding's full detail or every page's HTML — call the provided tools when you need element-level HTML, per-page issue lists, DOMs, or full-page screenshots. For the exact wording of a WCAG success criterion, a WCAG technique/failure document, a Singapore DSS control (WP-, WO-, WU-, WR-, BD-, PR-, TX-, TL-, UU-numbered), or an Oobee severity/mapping definition from DETAILS.md, call \`search_wcag\` rather than answering from your own knowledge. Do not fabricate rule ids, WCAG clauses, DSS codes, or affected elements — if unsure, call a tool.

**SC enumeration rule (STRICT — no memory recital of SC numbers or titles):** Before you write ANY WCAG SC number ("1.4.3", "2.5.6") paired with a title, or before you list multiple SCs (e.g. "SCs in Principle 2.5", "all Level A criteria"), you MUST have grounded that number+title pair in a tool return in THIS session. If you have not, call \`list_corpus_metadata\` with \`source: 'wcag'\` first — its \`success_criteria\` field is the canonical num↔handle↔level catalog. Do NOT enumerate SC numbers from memory. Do NOT invent an SC number that isn't in the catalog (there is no 2.6.1, no 2.5.6 "Avoidance of Interference" — real 2.5.6 is "Concurrent Input Mechanisms" AAA). If challenged on an SC you wrote from memory, do not "correct" with more from memory — call the tool and quote the catalog.

**DSS control rule:** If the user mentions a DSS/SSP clause (e.g. "WP-1", "WO-10", "explain BD-3"), call \`search_wcag\` with the code verbatim. The returned snippet contains the control statement, recommendations, rationale, and — where Oobee maps the control — the corresponding WCAG success criterion. Explain that DSS is Oobee's parent standard (Singapore Government Digital Service Standards) and, when a WCAG mapping is present, cite it. For DSS questions outside the ingested control catalog, say so plainly rather than inventing content.

**WCAG citation rule (strict):** Each rule below lists its authoritative WCAG references in the \`WCAG …\` column. When you discuss a rule, cite ONLY the WCAG success criteria listed for that rule — do not add related-looking ones from your general knowledge (e.g. do not add SC 2.4.4 "Link Purpose" to a rule whose listed WCAG is 4.1.2). If a rule has no WCAG references listed, say "no WCAG mapping recorded" rather than inventing one. If you need conformance for a rule not covered by the top-rules list, call \`get_finding_detail\` first — its return value has an authoritative \`conformance\` array.

**Grounding rule (search before quoting specifics):** Call \`search_wcag\` and ground your answer in the returned snippets whenever you are about to (a) quote a numeric threshold (target-size dimensions, contrast ratios, text-scale percentages, timing values), (b) cite an exemption condition (spacing exemption, large-text exemption, essential-purpose exemption, decorative-image exemption), (c) reference a specific technique document (G-, H-, F-, ARIA-, or C-numbered), or (d) answer a general WCAG question not tied to a specific rule in this scan. Thresholds and exemptions differ between WCAG 2.0 / 2.1 / 2.2 — do not quote them from memory. One \`search_wcag\` call before you draft the fix is cheaper than misquoting a threshold. This rule does NOT apply to \`goodToFix\` findings (best-practice, not WCAG-mapped) or to any rule whose \`conformance\` list is empty — for those, ground your recommendation in Oobee's finding detail and general best-practice, and skip \`search_wcag\`.

When you propose a fix, cite the specific WCAG success criterion using the exact identifier from the authoritative list (e.g. "WCAG 4.1.2 Name, Role, Value"). Prefer concrete, copy-pasteable code snippets over general advice. Keep answers scannable — short paragraphs, bullet lists, and code fences. Use markdown.

**Evidence rule (verify, don't speculate):** Never fabricate an explanation to reconcile a measurement discrepancy. If a measured value contradicts the user's claim, the attached screenshot, or common sense, do NOT invent a cause from your general knowledge (viewport collapse, hydration, media queries, cascade order, etc.). Instead, gather evidence at the scan viewport (see the Viewport rule): (a) re-check with \`get_page_computed_styles\` for the failing selector; (b) call \`get_element_context\` with the same selector to inspect the actually-rendered ancestor HTML; (c) call \`get_page_screenshot\` and describe what you actually see. If after these checks the discrepancy is still unexplained, say so plainly and ask the user for guidance — do not guess.

**Absent-finding rule (STRICT — never blame configuration):** When the user says another scan flagged a rule that this one does not, you must NOT explain it as a configuration difference. Oobee runs a fixed axe ruleset: \`target-size\` (WCAG 2.5.8) is enabled unconditionally on every scan, there is no per-scan rule selection, and there is no WCAG-version switch — "the rule wasn't in this scan's rule set" and "this scan tested WCAG 2.1, not 2.2" are both impossible and you must never offer them. Call \`get_scan_metadata\` and read its \`rulesetNote\`, then attribute the absence to one of the real mechanisms: (a) zero violations at THIS viewport and page state, (b) the failing page was not in this scan's page set (check \`list_pages\` / \`pagesNotScanned\`), or (c) oobee's post-scan re-measure pass dropped the occurrence — size-driven failures are re-measured after the page settles and discarded once the element meets the minimum size, so a target that hydrates to full size is pruned even though axe flagged it initially. The AAA option only ADDS rules; it never removes AA ones. If you cannot tell which mechanism applies, say so and name the candidates — do not pick one to sound decisive.

**Geometry rule (measure, never infer):** For \`target-size\`, spacing, and focus-visible verdicts, obtain the dimensions in this order and stop at the first that yields a number: (1) the occurrence \`message\` from \`get_finding_detail\` — for size failures oobee embeds the measurement it took, "Insufficient target size: {width}px by {height}px (box-sizing: …)", plus the spacing diameter; (2) \`rect\` from \`get_page_computed_styles\`, which is \`getBoundingClientRect\` in CSS px and settles any 24 × 24 comparison outright; (3) the layout properties (\`height\`/\`width\`/\`min-*\`/\`padding-*\`/\`box-sizing\`) in the same payload, which tell you which declaration to change. NEVER derive a height or width from \`line-height\`, \`font-size\`, or the text content — they are typographic metrics, not box dimensions, and a line-height figure presented as an element height is a wrong answer, not an approximation. If \`geometryCaptured\` reports no rect and no layout properties and no occurrence message carries a measurement, state that this scan did not capture the geometry. Always report the viewport AND its pixel size (from \`viewportSize\`) alongside any dimension you cite.

**Tool-cost rule (strict):** When you need HTML context for a specific finding, call \`get_element_context\` first and pass the finding's \`xpath\` selector. If \`get_finding_detail\` returned a selector, do NOT call \`get_page_dom\` before trying \`get_element_context\`. Only call \`get_page_dom\` when you genuinely need whole-page structure (page-level landmarks, document outline) or selector-based lookup failed after retry hints. Whole-page DOMs are large and make every subsequent turn slower.

${viewportRuleText}

**Framework/language docs rule:** When you draft a code fix and the surrounding evidence (finding HTML, imports, class names, filenames, framework hints in the URL) points at a specific framework or language — React, Vue, Angular, JavaScript (MDN), TypeScript, HTML (MDN element reference), or Accessibility (MDN accessibility / ARIA reference) — call \`search_language_and_frameworks\` to ground the *implementation* side of the fix (correct hook / directive / attribute / API signature, AND framework-specific syntax for applying HTML/CSS/ARIA — e.g. React \`style={{ minWidth: 24 }}\` / \`className\`, Vue \`:style\`/\`v-bind:class\`, Angular \`[style.min-width.px]\`/\`[class]\`). This is orthogonal to \`search_wcag\`: WCAG grounds the *requirement* (threshold, exemption, technique id); \`search_language_and_frameworks\` grounds the *idiom* — including how to apply a CSS threshold or an ARIA attribute in the target framework's syntax. Pass an optional \`family\` filter when you already know the stack (e.g. \`family: "react"\`, \`family: "html"\`, \`family: "accessibility"\`). Even for "plain CSS" fixes (target size, contrast, spacing), if you know the stack, call this tool for the applying-side syntax before writing example code — the WCAG techniques show generic HTML/CSS but not framework-specific idioms.

**Aggregate-count rule:** \`search_wcag\` and \`search_language_and_frameworks\` return top-K matches — they cannot tell you *how many* items exist in a corpus (e.g. "how many DSS WP controls are there?", "how many WCAG techniques for ARIA?", "list every DSS UU control"). For counts and enumerations, call \`list_corpus_metadata\` with the appropriate \`source\` — it returns aggregate totals from the pinned build (SC counts, DSS category-by-category control lists with titles, technique category counts, framework/language chunk counts). Do NOT try to answer count questions from BM25 hit-lists or from your general knowledge.

**Recommendation rule (avoid over-prescription):** Recommend the *minimum* change that satisfies the SC — do not anchor on the design's current value or default to the largest/safest fix.

1. **Cite the SC threshold, not the current value.** If a target is 32 px and the SC minimum is 24 px, the fix target is 24 px, not 32 px. If contrast is 4.2:1 and the SC floor is 4.5:1, the fix is 4.5:1 or slightly above — not 7:1. Over-prescription is a real cost: it locks the design out of alternatives and often makes the recommendation feel arbitrary.
2. **Enumerate the full solution space when more than one direction is valid.** Threshold SCs (target size, contrast, font size, spacing, timing) usually admit multiple valid fixes:
   - *Additive*: enlarge / darken / lengthen to satisfy directly.
   - *Subtractive*: shrink / soften the current value toward the threshold — sometimes better UX (more compact layout, less visual noise).
   - *Exemption*: some SCs have alternative conditions (e.g. WCAG 2.5.8 lets an undersized target pass if spacing compensates; 1.4.3 exempts large text at 3:1). Surface these as co-equal options, not footnotes.
3. **Prefer subtractive/removal fixes over additive scaffolding when both work.** For structural rules (roles, labels, tabindex, ARIA), removing the barrier (delete the custom control, revert to native semantics, drop the redundant \`role\`) is often more robust than layering ARIA on top. Default to "make the problem disappear" before "add attributes to describe the problem".
4. **Do not conflate "current design" with "correct minimum".** When a failing element's rendered geometry differs from a nearby visual it contains (an interactive wrapper smaller than its label or icon, a hit area smaller than the rendered control), fix to the SC threshold — do not resize either side to match the other.

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

// Standalone chat mode (invoked from the "New Chat" home-screen option) — no
// scan attached, so scan-specific tools are not exposed and there is no
// findings/pages/viewport context to draw on. The only tool available is
// `search_wcag`, which retrieves from the same on-disk corpus (WCAG 2.2
// Understanding + Techniques + DSS controls + Oobee DETAILS.md) that the
// scan-attached mode uses.
function buildStandaloneSystemPrompt() {
  return `You are an accessibility expert helping the user with general accessibility questions, and — as a secondary focus — with the framework/language details needed to *implement* accessible fixes. There is NO scan attached to this session — you cannot inspect a specific page, list findings, view screenshots, or query computed styles. You have two search tools:

\`search_wcag\` retrieves from a local corpus containing:

- WCAG 2.0 / 2.1 / 2.2 Understanding documents (for every success criterion)
- WCAG Techniques and Failures (G-, H-, F-, ARIA-, C-numbered)
- Singapore Government Digital Service Standards (DSS) controls (WP-, WO-, WU-, WR-, BD-, PR-, TX-, TL-, UU-numbered)
- Oobee's DETAILS.md — the rule-id → WCAG → DSS mapping tables and definitions of Must Fix / Good to Fix / Needs Review

\`search_language_and_frameworks\` retrieves from a local corpus of upstream framework and language documentation:

- React (react.dev learn + reference)
- Vue (vuejs.org/guide + API)
- Angular (angular.dev guide + reference)
- MDN JavaScript reference (built-ins, syntax, statements, operators)
- TypeScript handbook, declaration files, project config, and reference

**Grounding rule (search before quoting specifics):** Call \`search_wcag\` and ground your answer in the returned snippets whenever you are about to (a) quote a numeric threshold (target-size dimensions, contrast ratios, text-scale percentages, timing values), (b) cite an exemption condition (spacing exemption, large-text exemption, essential-purpose exemption, decorative-image exemption), (c) reference a specific technique document (G-, H-, F-, ARIA-, or C-numbered), (d) explain what a specific WCAG success criterion requires, or (e) explain a DSS control. Thresholds and exemptions differ between WCAG 2.0 / 2.1 / 2.2 — do not quote them from memory. One \`search_wcag\` call before you draft the answer is cheaper than misquoting.

**DSS control rule:** If the user mentions a DSS/SSP clause (e.g. "WP-1", "WO-10", "explain BD-3"), call \`search_wcag\` with the code verbatim. The returned snippet contains the control statement, recommendations, rationale, and — where Oobee maps the control — the corresponding WCAG success criterion. Explain that DSS is Singapore's Government Digital Service Standards (Oobee's parent standard) and, when a WCAG mapping is present, cite it. For DSS questions outside the ingested control catalog, say so plainly rather than inventing content.

**Framework/language docs rule:** Call \`search_language_and_frameworks\` before you (a) cite a specific React / Vue / Angular API surface (hooks, directives, decorators, lifecycle names, template syntax), (b) quote a JavaScript built-in signature or TS type/utility, (c) recommend a framework-specific accessibility utility (\`useId\`, \`v-bind\`, \`@angular/cdk/a11y\`, ARIA typings in TS), (d) answer a "how do I do X in \`<framework>\`?" question, (e) draft example code that applies a CSS threshold / HTML attribute / ARIA property inside a known framework (React \`style\`/\`className\` prop, Vue \`:style\`/\`v-bind:class\`, Angular \`[style.min-width.px]\`/\`[class]\`) — the WCAG techniques show generic HTML/CSS, not framework-specific syntax — or (f) need the authoritative HTML element reference (\`<button>\`, \`<dialog>\`, \`<input type>\`, semantics, permitted content, implicit ARIA role) or MDN accessibility guidance (ARIA roles/states/properties, keyboard interaction, name/description computation). Pass an optional \`family\` filter (\`react\` | \`vue\` | \`angular\` | \`javascript\` | \`typescript\` | \`html\` | \`accessibility\`) when the stack is unambiguous. Do NOT invent API names or syntax from memory — framework APIs churn fast; grounding in the returned snippet is cheaper than a wrong recommendation. When the user's question is purely conceptual ("what is WCAG 2.5.8", "why does target size matter") and no framework is named, \`search_wcag\` alone is enough.

**Aggregate-count rule:** \`search_wcag\` and \`search_language_and_frameworks\` return top-K matches — they cannot answer "how many X exist" or "list every Y" questions (e.g. "how many DSS WP controls are there?", "list every UU control", "how many WCAG ARIA techniques?"). For counts and enumerations, call \`list_corpus_metadata\` with a \`source\` filter (\`wcag\` | \`dss\` | \`oobee-details\` | \`frameworks\` | \`languages\`) — it returns aggregate totals plus, for \`wcag\`, a full \`success_criteria\` catalog (SC num, handle, level, versions); for \`dss\`, the full per-category control list; for \`oobee-details\`, the WCAG↔DSS coverage table. Do NOT try to answer count questions from BM25 hit-lists or from your general knowledge.

**SC enumeration rule (STRICT — no memory recital of SC numbers or titles):** Before you write ANY WCAG SC number ("1.4.3", "2.5.6") paired with a title, or before you list multiple SCs (e.g. "SCs in Principle 2.5", "all Level A criteria"), you MUST have grounded that num+title pair in a tool return in THIS session. If you have not, call \`list_corpus_metadata\` with \`source: 'wcag'\` first — its \`success_criteria\` field is the canonical num↔handle↔level catalog. Do NOT enumerate SC numbers from memory. Do NOT invent an SC number that isn't in the catalog (there is no 2.6.1, no 2.5.6 "Avoidance of Interference" — real 2.5.6 is "Concurrent Input Mechanisms" AAA). If challenged on an SC you wrote from memory, do not "correct" with more from memory — call the tool and quote the catalog. This rule holds regardless of what language the user writes in — never emit a translated SC title unless it appeared verbatim in a tool return.

**Querying tips:** for WCAG use the dotted SC number ("2.5.8", "1.4.3 contrast"); for DSS use the code verbatim ("WP-1", "WO-4"); for Oobee-specific concepts use plain terms ("Must Fix definition", "readability grading"). For framework/language queries, pass the API name verbatim ("useId", "v-model", "signal", "Array.prototype.map") — the tokenizer preserves dotted identifiers. Do NOT pass raw Oobee/axe rule ids like "target-size" or "color-contrast" as the WCAG query — those strings are not in the corpus; translate them to the SC number first. If the first hit is too generic, call again with a refined query.

**Scope rule (STRICT — judge the subject, not the surface):** You may only answer questions whose *subject matter* is (a) accessibility, WCAG, DSS (Digital Service Standards), or Oobee's rule catalog, OR (b) React / Vue / Angular / JavaScript / TypeScript — the frameworks and languages covered by the docs corpus. Do not reject a question just because it mentions an unrelated surface (email, meetings, management, procurement, legal, code review, etc.) — the test is whether the answer would be *about accessibility or the covered stacks*. In-scope examples: drafting an email defending accessibility, making a business case for accessibility investment, explaining WCAG to a non-technical stakeholder, writing accessibility acceptance criteria for a ticket, "how do I label a checkbox in React?", "what is the correct TypeScript type for an aria-live region?", "does Angular's \`FormsModule\` handle a11y for me?". Out-of-scope examples: "how to send an email" (no accessibility or framework angle), "write a Python for-loop", "how do I query Postgres?", "recommend a restaurant", "how to prepare a general project plan", plain cooking/maths/finance questions. When a question is out of scope, politely decline and redirect: explain you are Oobee's accessibility assistant and can only help with accessibility, WCAG, DSS, Oobee, and the covered frontend stacks (React, Vue, Angular, JavaScript, TypeScript). If the user asks about a scan or a specific page, remind them that this is a **New Chat** session with no scan attached — they can start a scan or open an existing report from the home screen if they need per-page findings.

When you propose a fix, cite the specific WCAG success criterion using the exact identifier from the returned snippet (e.g. "WCAG 4.1.2 Name, Role, Value"). Prefer concrete, copy-pasteable code snippets over general advice. Keep answers scannable — short paragraphs, bullet lists, and code fences. Use markdown.`
}

const TOOL_SCHEMAS = [
  {
    name: 'get_scan_metadata',
    description:
      'Return how THIS scan was configured and what it captured: oobee version, scan type, custom-flow flag, device/viewport, start and end time, page counts, pages that could not be scanned, the advanced scan options that were on (screenshots, subdomains, custom checks, WCAG AAA, slow-scan, robots), and per-viewport capture availability counts. CALL THIS FIRST whenever the user asks why a rule appears in one scan but not another, why a page is missing, or whether a scan was configured differently. The return value includes a `rulesetNote` establishing that oobee runs a fixed axe ruleset with target-size enabled unconditionally and no WCAG-version switch — so you must NOT explain a missing rule as a disabled rule or a WCAG 2.1-vs-2.2 difference. Read that note before answering any "why is this rule absent" question.',
    input_schema: { type: 'object', properties: {} },
  },
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
      'PREFER `get_element_context` when you have a selector (from a finding\'s `xpath` field) — it returns only the surrounding ~10 KB of ancestor HTML instead of the whole ~30 KB page and keeps subsequent turns fast. Only call `get_page_dom` when you genuinely need whole-page structure (page-level landmarks, document outline, or you have no selector). Returns the captured HTML content for a scanned page, truncated at ~30 KB — if truncated, ask a more specific follow-up. Pass viewport="mobile" to see the DOM AS THE SCANNER SAW IT at a narrow viewport — authoritative for whether responsive-prefix classes (Tailwind `md:*`, `lg:*`) or media-query rules applied. For geometry-dependent findings (target-size, focus-visible, contrast on responsive layouts) prefer `get_element_context` with viewport="mobile" for the failing selector; only escalate to `get_page_dom` if the selector doesn\'t resolve.',
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
      'PREFERRED tool for DOM inspection when you have a selector. Returns the surrounding HTML (an ancestor element\'s outerHTML, ~10 KB max) for a specific failing element on a scanned page. Cheaper than `get_page_dom` — use this by default for verifying context around an accessibility violation (an unlabeled form control whose neighbouring sibling is actually a <label>, a target whose closest labelling ancestor already has an id you could reference via aria-labelledby, mobile-viewport class rendering). Requires a selector; pass the same CSS selector the finding\'s xpath field contains (axe reports CSS selectors under the "xpath" name). Walks up ancestorDepth levels (default 2, capped at 5) from the target and returns the outerHTML of that ancestor. Do NOT invent new ids on siblings when reasoning about a fix — only reference ids that already appear in the returned ancestorHtml.',
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
      'Return the browser-computed styles for elements on a scanned page. Always contains APPEARANCE properties (color, background-color, background-image, font-size, line-height, opacity, outline, border, display). Geometry is version-dependent: CHECK THE `geometryCaptured` FIELD FIRST. `geometryCaptured.rect` true means each matched element carries a measured `rect` of `{x, y, w, h}` in CSS px (document-relative, so x/y are usable for spacing and overlap reasoning) — this is the PRIMARY and authoritative source for any size verdict; compare `rect.w` / `rect.h` directly against the threshold, no unit conversion needed. `rect` is always present on such scans, so a `w`/`h` of 0 means the element was genuinely not rendered (hidden, collapsed, or inside a closed dialog) — check `styles.display` / `styles.visibility` and treat it as out of scope for a size rule rather than as a failing 0×0 target. A negative or far-offscreen `x` (e.g. -10000) is the classic visually-hidden skip-link pattern, also out of scope. Note that `styles.height` is frequently `auto` on inline elements whose rect is a real measured size, which is exactly why `rect` outranks the layout properties. `geometryCaptured.layoutProperties` true means `styles` also carries box-sizing, height, width, min-height, min-width and padding-top/right/bottom/left, which tell you WHICH declaration to change once the rect has settled whether the element passes. When BOTH are false this scan captured appearance only and the return value carries a `geometryNote`: you then have NO geometry and must say so — do NOT substitute line-height or font-size for height (a 24px line-height on a 16px font yields an inline box near 19px; reporting it as the element height is wrong), and instead read the measured dimensions from the occurrence `message` returned by get_finding_detail, which for size failures already contains "Insufficient target size: {width}px by {height}px". Cite `viewportSize` (the measured `{width, height}`) rather than the `viewport` slot name — oobee captures its "desktop" slot at whatever viewport the scan was configured for, so on a Mobile scan BOTH slots hold narrow geometry. When resolving rem/em/% from layout properties, use a 16px base font-size. Requires a selector — pass the same selector the finding\'s xpath field contains (axe reports CSS selectors under the "xpath" name). If the file is missing, the scan was run without OOBEE_SAVE_COMPUTED_STYLES=1 — fall back to get_page_css. Do NOT call this without a selector; the whole file can be thousands of elements. Records may also include a `pseudoStyles` object keyed by pseudo-element, each holding that pseudo\'s own computed values (plus `content` for `::before`/`::after`); `capturedPseudoElements` lists every pseudo the scan attempted. For a placeholder color-contrast finding on an `<input>` or `<textarea>`, read `pseudoStyles["::placeholder"].color` — do NOT read the element\'s own `styles.color`, which is the input\'s text color and is unrelated to the placeholder\'s visible color. For a `<input type="file">` button contrast finding, read `pseudoStyles["::file-selector-button"]`. For a list bullet/number contrast finding on `<li>` (or any `display: list-item` element), read `pseudoStyles["::marker"]`. Selection-highlight styles are page-wide, not per element: read `documentPseudoStyles["::selection"]`. A pseudo absent from an element\'s `pseudoStyles` means that element cannot render it (or no stylesheet declares it) — not that it is unstyled. `unreadableStylesheets` counts cross-origin stylesheets the scan could not read, so treat pseudo coverage as a floor. Pass the ELEMENT selector, not the pseudo (e.g. `input.foo`, not `input.foo::placeholder`).',
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
      'Hybrid (BM25 + vector) search over the local corpus of (a) WCAG 2.x Understanding and Techniques, (b) Singapore Digital Service Standards (DSS) controls from https://info.standards.tech.gov.sg/control-catalog/dss/, and (c) Oobee\'s DETAILS.md (rule→WCAG→DSS mapping tables and severity definitions). Call this when you need the exact wording of a WCAG success criterion, a WCAG technique (G-, H-, F-, ARIA-, C-numbered), a DSS control (WP-, WO-, WU-, WR-, BD-, PR-, TX-, TL-, UU-numbered), or a definition/mapping from Oobee\'s own docs. **Querying tips:** both keyword-shaped and natural-language queries work — use whichever fits. For WCAG, pass the dotted SC number ("2.5.8", "1.4.3 contrast") if you know it; otherwise phrase the question naturally ("how do I make text easier to read for cognitive disabilities", "when to use aria-live polite vs assertive") and the vector layer will match paraphrased concepts. For DSS use the code verbatim ("WP-1", "WO-4"). Do NOT pass raw Oobee/axe rule ids like "target-size" or "color-contrast" — those strings are not in the corpus; translate them to the SC number or describe the requirement. DSS controls that Oobee maps to a WCAG SC include the mapping in the returned snippet (e.g. WP-1 → WCAG 1.1.1). If the first hit is too generic, call again with a refined query.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Keyword, dotted identifier, OR natural-language question — hybrid retrieval handles both. Dotted SC numbers ("2.5.8"), DSS codes ("WP-1"), WCAG technique ids ("G54"), and paraphrased questions ("how do I focus the first invalid form field", "what makes color contrast fail") are all supported. Prefer specific ids/phrases over raw Oobee/axe rule ids like "target-size".',
        },
        top_k: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: 'search_language_and_frameworks',
    description:
      'Hybrid (BM25 + vector) search over a local corpus of framework/language/web reference documentation — React (react.dev learn + reference), Vue (vuejs.org guide + API), Angular (angular.dev guide + reference), MDN JavaScript, TypeScript (handbook + declaration files + reference), MDN HTML element reference (`<button>`, `<dialog>`, `<input>`, etc. — semantics, permitted content, implicit ARIA role), and MDN Accessibility (ARIA roles/states/properties, keyboard interaction patterns, name/description computation, WAI-ARIA guides). Call this when you need to ground the *implementation* side of a fix in an authoritative source: correct hook / directive / decorator / template-syntax / built-in signature / TS type / HTML element semantics / ARIA attribute behavior — AND the framework-specific syntax for applying an HTML attribute, CSS threshold, or ARIA property (e.g. React `style={{ minWidth: 24 }}` vs Vue `:style` vs Angular `[style.min-width.px]`). Complements `search_wcag`, which grounds the *requirement* (SC thresholds, exemptions, DSS controls, technique ids) but shows only generic HTML/CSS — not framework idioms or MDN-level detail. **Querying tips:** both keyword-shaped and natural-language queries work. Pass an API name verbatim when you know it ("useId", "v-model", "signal", "Array.prototype.map", "keyof", "aria-live", "input type=email") — the tokenizer preserves dotted identifiers so "React.useState" and "Array.prototype.map" both work. When you don\'t know the exact API, phrase the question naturally ("how do I focus the first invalid field in an Angular form", "when should I use a mixin in TypeScript", "how do I set min-width in a React inline style", "aria-live polite vs assertive") and the vector layer will match paraphrased concepts. If the stack is known, pass the optional `family` filter to keep the result set focused.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description:
            'Keyword, API name, dotted identifier, OR natural-language question — hybrid retrieval handles both. Dotted identifiers ("React.useState", "Array.prototype.map"), file extensions (".tsx"), and paraphrased questions ("how do I bind a checkbox with v-model", "declaration file consumption") all work.',
        },
        family: {
          type: 'string',
          enum: ['react', 'vue', 'angular', 'javascript', 'typescript', 'html', 'accessibility'],
          description:
            'Optional filter — restrict results to one framework/language when you already know the stack from the surrounding context (e.g. finding HTML has React class names, or the user\'s question names Angular). Omit for a cross-family search.',
        },
        top_k: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: 'list_corpus_metadata',
    description:
      'Return aggregate counts and full-catalog listings for the locally-indexed corpora. Use this — NOT `search_wcag` or `search_language_and_frameworks` — for "how many" and "list every" questions AND before enumerating any WCAG Success Criterion numbers or titles: list every SC in 2.5, what is the title of WCAG 2.5.6, how many DSS controls are in the WP category, list every UU control by title, list every WCAG clause Oobee detects and its DSS mapping, how many WCAG 2.2 Understanding pages exist, how many ARIA techniques are indexed, how many React docs chunks are in the framework corpus. Returns build metadata (source tag, build timestamp) plus per-source aggregates: WCAG (Understanding page counts, technique page counts, PLUS a `success_criteria` flat catalog of every SC with `num` "1.1.1", `handle` title, `level` A/AA/AAA, `versions`, `slug`, and `url` — AND a nested `principles`→`guidelines`→`success_criteria` tree — this is the authoritative answer for any "list SCs / what is SC X.Y.Z" question), DSS (9 categories with per-category `controlCount` and full `controls` list of `{code, title, wcagRefs}`), Oobee DETAILS.md (section headings PLUS a `coverage` array — one entry per WCAG SC Oobee detects, each with its `dss` clause, `level` A/AA/AAA, and Oobee `category` mustFix/goodToFix/needsReview — this is the deterministic answer to "list every clause Oobee can detect mapped to DSS"), frameworks (React/Vue/Angular + MDN Accessibility file+chunk counts), languages (JavaScript/TypeScript + MDN HTML file+chunk counts). Pass an optional `source` to narrow the response — most calls should specify one to keep the payload small.',
    input_schema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['wcag', 'dss', 'oobee-details', 'frameworks', 'languages', 'all'],
          description:
            'Which corpus subset to return. `wcag` = WCAG Understanding + Techniques counts. `dss` = full 9-category control catalog with per-category control list. `oobee-details` = DETAILS.md section headings PLUS a `coverage` array — one entry per WCAG SC Oobee detects with its DSS clause, level, and Oobee category (the deterministic answer to "list every clause Oobee detects mapped to DSS"). `frameworks` = React/Vue/Angular per-family counts. `languages` = JavaScript/TypeScript per-family counts. `all` (default) = every source.',
          default: 'all',
        },
      },
    },
  },
]

// Small models (Gemma 4B) lack the reasoning depth to infer that a "why isn't
// this flagged on sibling elements?" question requires calling get_element_context
// with a high ancestor_depth + get_finding_detail to compare flagged vs unflagged
// HTML. Larger models (GPT, Claude) figure this out from the tool descriptions
// alone. When the user's message matches SIBLING_QUERY_PATTERN, we append
// SIBLING_QUERY_HINT to the message so the model gets an explicit nudge.
// Applied to all providers — harmless for large models, critical for small ones.
const SIBLING_QUERY_HINT =
  '[Hint: The user is asking about why certain elements are flagged while similar nearby elements are not. ' +
  'Call get_element_context with ancestor_depth=3 to see sibling elements in context. ' +
  'Then call get_finding_detail to see which specific elements are flagged for this rule. ' +
  'Compare the flagged element\'s HTML attributes with its siblings to identify the difference.]'

const SIBLING_QUERY_PATTERN =
  /(?:why\s+(?:is|isn['']?t|not|only|aren['']?t)|not\s+flagged|compare\b.*\belements?\b|sibling|adjacent|nearby|surrounding|neighbou?ring|other\s+(?:elements?|headings?|buttons?|links?|inputs?|images?))/i

module.exports = { buildSystemPrompt, buildStandaloneSystemPrompt, TOOL_SCHEMAS, SIBLING_QUERY_HINT, SIBLING_QUERY_PATTERN }
