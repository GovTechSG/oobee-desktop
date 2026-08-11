# LLM analysis prompt design

This document explains the design of the system prompt, tool schemas, and
per-occurrence user prompts used by the LLM analysis chat. It is meant for
future maintainers deciding whether to change the wording, add tools, or swap
providers.

The code that produces these prompts:

- [`llmPrompts.js`](./llmPrompts.js) — system prompt template + tool schemas
- [`llmAnalysis.js`](./llmAnalysis.js) — Anthropic (Claude) turn strategy + shared tool dispatch
- [`llmGemma.js`](./llmGemma.js) — Gemma 4 E4B turn strategy via `node-llama-cpp`
- [`../../src/MainWindow/ChatPage/index.jsx`](../../src/MainWindow/ChatPage/index.jsx) — the per-occurrence "Ask about this" user prompt

## What we are trying to achieve

The chat lets a user reason about an Oobee accessibility scan without
opening the HTML report. The prompt design has to balance four competing
pressures:

1. **Give the model enough context to answer without asking follow-ups.**
   A scan can have hundreds of findings; loading them all into the prompt
   would blow the context window (Gemma 4 E4B locally is capped at 16–64 K
   tokens depending on RAM headroom — see `pickContextSize()` in
   [`llmGemma.js`](./llmGemma.js)).

2. **Keep the model from fabricating rule ids, WCAG references, and DOM
   elements.** Small local models hallucinate confidently. Every fabrication
   is a bug report waiting to happen for accessibility engineers who trust
   the summary.

3. **Work identically for cloud (Claude) and local (Gemma).** The same 7
   tools, the same system prompt, the same output shape — the provider
   dropdown should be a paint job on top of an otherwise-shared contract.

4. **Match a user mental model of "I clicked on that specific issue, help me
   fix it".** Answers should cite copy-pasteable code, not generic advice.

## System prompt

Built by `buildSystemPrompt({ summary })` in
[`llmPrompts.js`](./llmPrompts.js). Structure:

1. **Role framing.** The model is told it is an "accessibility triage
   expert" reviewing an Oobee scan. Concrete role framing produces more
   grounded output than a generic "helpful assistant" system prompt.

2. **Category glossary.** `mustFix` = WCAG A/AA violation, `goodToFix` =
   best practice, `needsReview` = automated tooling was uncertain. Without
   this, the model conflates the three and calls needs-review findings
   violations.

3. **Tool discipline.** Explicit line: "you do NOT have every finding's full
   detail or every page's HTML — call the provided tools when you need
   element-level HTML, per-page issue lists, DOMs, or full-page
   screenshots." Followed by: "Do not fabricate rule ids, WCAG clauses, or
   affected elements — if unsure, call a tool." This is the primary
   anti-hallucination lever; the model prefers to guess when it thinks
   there is no other option.

4. **WCAG citation rule (strict).** Called out under its own heading. Only
   cite WCAG success criteria present in the authoritative `conformance`
   field of each rule. Say "no WCAG mapping recorded" rather than invent.
   For rules outside the top-rules list, call `get_finding_detail` first.
   Added after observing Gemma inventing SC 2.4.4 for `link-name` and
   `oobee-accessible-label` (whose real mappings are 4.1.2 and 2.1.1+4.1.2).

5. **Formatting guidance.** Markdown, short paragraphs, bullet lists, code
   fences, WCAG references with the exact identifier. Kept short so it
   does not push the model toward preamble-heavy answers.

6. **Scan overview block.** URL, pages scanned, WCAG AA automated score
   (X of Y checks passed) — the same shape as Oobee's own summary EJS
   template so users recognise the numbers.

7. **Top violated rules (must-fix).** Rule id, description, occurrence
   count, WCAG references. WCAG references are translated to human
   Success Criteria via `formatWcagConformance()` — see
   [WCAG axe-tag translation](#wcag-axe-tag-translation) below.

8. **Top pages by issue count.** Just a pointer — the model uses this to
   decide which page to drill into with `get_page_detail`.

9. **Full findings index (`indexBlock`).** A compact JSON dump of every
   rule id + description + occurrence count across all three categories.
   Capped at `MAX_INDEX_KB` (see `llmAnalysis.js`) so a very large scan
   does not push the context past its limit. This is what lets the model
   answer "what rules are failing" without a tool call for every question.

### What is deliberately NOT in the system prompt

- **Element HTML.** Per-occurrence HTML is delivered on-demand via
  `get_finding_detail`. Baking it into the system prompt would multiply
  the prompt by the number of occurrences (100s per scan) and force us
  to prioritize a subset arbitrarily.
- **Page DOMs.** Delivered via `get_page_dom` at ~30 KB per page, on
  request. Baking a full DOM would consume tens of KB per page.
- **Screenshots.** Delivered via `get_page_screenshot` (full-page) or as
  attachments on `get_finding_detail` calls (per-element). Only Claude
  can consume image blocks — Gemma is text-only via `node-llama-cpp` v3
  (tracked upstream at
  <https://github.com/withcatai/node-llama-cpp/issues/88>, targeted for
  v4.0.0). See the reasoning block at the top of `streamGemmaChat` in
  [`llmGemma.js`](./llmGemma.js).

## Tool schemas

Seven tools, all defined in `TOOL_SCHEMAS` in
[`llmPrompts.js`](./llmPrompts.js). Design principles:

- **Slim previews, drill-down on demand.** `list_findings` returns
  category / rule / description / count / axeImpact / conformance —
  enough for the model to filter, but not the actual HTML. If the model
  needs the HTML, it calls `get_finding_detail`.
- **JSON Schema, provider-neutral.** The same schemas feed Anthropic's
  `tool_use` and Gemma's `defineChatSessionFunction` (via
  `sanitiseSchema()` in [`llmGemma.js`](./llmGemma.js)). No provider
  extensions — the schemas stay in the JSON Schema subset both accept.
- **Truncation contract.** Anything that can be large (tool payloads,
  page DOMs) is truncated at ~30–40 KB and the payload includes a
  `truncated: true` marker so the model can decide whether to ask a
  narrower follow-up.
- **Screenshots as attachments, not JSON.** For per-element and full-page
  screenshots the tool response has a `__attachments` (or `__imageContent`)
  marker; the shared dispatcher pulls the base64 out and emits it either
  as an Anthropic `image` content block (Claude) or as an
  `llmChat:attachment` IPC event to the renderer plus a text note to the
  model (Gemma).

| Tool | Returns | Used when |
|------|---------|-----------|
| `list_findings` | slim rules with category/count/conformance | model wants to filter or plan |
| `get_finding_detail` | full rule detail + occurrences (HTML, xpath, message) + element screenshots | model needs actual DOM context or the user asked about a specific rule |
| `list_pages` | pages scanned with per-page issue count | model wants to find "worst page" |
| `get_page_detail` | all findings on one page | model needs to answer "what's wrong with page X" |
| `list_page_captures` | which pages have DOM / screenshot artifacts | pre-flight before requesting a DOM or screenshot |
| `get_page_dom` | ~30 KB of captured HTML | model needs to reason about actual document markup |
| `get_page_screenshot` | full-page screenshot (Claude sees image, Gemma gets a pointer) | model needs visual context |

## Per-occurrence "Ask about this" prompt

Built in `askAboutOccurrence(ctx)` in
[`ChatPage/index.jsx`](../../src/MainWindow/ChatPage/index.jsx). Fired when
the user clicks the button inside `SummaryCard`'s `OccurrenceBrowser`.

Shape of the message (all fields optional except rule):

```
About occurrence #N of the **{rule}** rule:
- Rule description: …
- Category: Must Fix | Good to Fix | Needs Review
- WCAG references (authoritative): WCAG X.Y.Z, WCAG A.B.C
- Impact: {axe severity}
- Help URL: …
- Page: … (title or URL)
- URL: …
- XPath: `…`
- Failure message: …
- Element:

    ```html
    <snippet up to 500 chars>
    ```

- A screenshot of the element is attached to this message. [only if present]

Why does this specific occurrence matter, and what would fix it?
When citing WCAG, use ONLY the references listed above (WCAG X.Y.Z, WCAG A.B.C).
Do not invent or substitute other WCAG success criteria.
```

Why this shape:

- **Authoritative fields listed inline.** The rule, description, category,
  WCAG conformance, and axe impact are all extracted from the scan and
  passed verbatim. If the model does not have to guess, it cannot invent.
- **HTML in a fenced block.** Marked-parsed answers can quote or diff the
  original element cleanly.
- **The closing sentence pins the model.** "Use ONLY the references
  listed above." is more effective than the system prompt's general
  guidance because it names the *specific* references the model must
  stick to. Empirically this eliminated the SC 2.4.4 hallucination on
  `link-name` and `oobee-accessible-label` for Gemma.
- **Screenshot attached only when available.** The renderer includes the
  data URI as an attachment on the user message. The `llmChat:send` IPC
  handler decides how to deliver it per provider (image block for
  Anthropic, metadata note for Gemma).

## WCAG axe-tag translation

Oobee and axe-core report WCAG conformance as raw axe tags:

```
["wcag2a", "wcag211", "wcag412"]
```

- `wcag2a` / `wcag2aa` / `wcag21aa` — level tags. Not Success Criteria.
- `wcag211` — SC 2.1.1 (Keyboard).
- `wcag412` — SC 4.1.2 (Name, Role, Value).

LLMs consistently fail to parse these. Gemma was observed inventing
`WCAG 2.4.4` and `WCAG 1.1.1` when handed `wcag2a, wcag211, wcag412` —
probably because it was trying to interpret `wcag2a` and `wcag211` as
free-text keywords rather than tag identifiers, and reaching for
associations from its training distribution.

`formatWcagConformance()` (defined in [`llmAnalysis.js`](./llmAnalysis.js)
and mirrored in [`ChatPage/index.jsx`](../../src/MainWindow/ChatPage/index.jsx))
runs on every conformance list that flows to the model:

- Drops level tags (`wcag2a`, `wcag21aa`, …) — they are not SC references
  and would just confuse the model.
- Expands numeric tags (`wcag211`) into human SCs (`WCAG 2.1.1`).
- Passes any already-formatted string through unchanged, so the helper is
  idempotent.

Applied at every emission point:

- `computeSummary()` → `topN()` → top-rules block in the system prompt.
- `computeSummary()` → `compactRule()` → findings index in the system
  prompt.
- `runTool.list_findings` return value.
- `runTool.get_finding_detail` return value (both `scanItems` and
  `issuesSummary` paths).
- `askAboutOccurrence()` in the renderer.

## Provider strategy

Both providers share the same tool contract, so the model behaviour
converges on the same shape of answers.

### Anthropic (Claude)

- Live token stream via SSE (`runChatLoop()` in
  [`llmAnalysis.js`](./llmAnalysis.js)).
- Tool use follows Anthropic's `input_json_delta` / `tool_use` conventions.
- User messages can be a mixed content array: `image` blocks (for
  attached screenshots) are prepended to the text.
- Loop cap: 10 tool hops per user turn.

### Gemma 4 E4B (local, `node-llama-cpp`)

- Runs entirely on-device. `pickContextSize()` sizes the KV cache from
  actual RAM headroom (tiered: 16 K / 32 K / 64 K).
- Tools registered via `defineChatSessionFunction`; the same JSON Schema
  is fed after `sanitiseSchema()` strips defaults that the underlying
  GBNF grammar builder ignores.
- **No image input.** node-llama-cpp v3 is text-only. When the user
  attaches a screenshot, the runner appends a metadata note (page,
  URL, xpath) so the model at least knows what it is missing.
- **Chat-template token filter.** Gemma 4's Jinja template uses
  `<channel|>reasoning` / `<channel|>final` / `<|tool_response>` /
  `<start_of_turn>` etc. to bracket structured segments. The unsloth
  Q4_K_XL GGUF ships with some of these control tokens
  mis-classified — a subset leaks into the visible stream. A stateful
  filter in `streamGemmaChat` strips known tokens with a bounded carry
  buffer so tokens split across chunk boundaries are not mangled.
- Sampling: `temperature=1.0, topP=0.95, topK=64` per the unsloth model
  card recommendation.

## Streamed-output normalization (renderer)

`normalizeLLMMarkdown()` in
[`ChatPage/index.jsx`](../../src/MainWindow/ChatPage/index.jsx) massages
common LLM markdown quirks before handing off to `marked`:

- Un-escapes `\*\*text\*\*` → `**text**` and `\*text\*` → `*text*`.
  Small models over-escape asterisks thinking they are "safely quoting"
  markdown; CommonMark reads `\*` as a literal asterisk, so the pair
  renders as visible `**`.
- Inserts a space between word chars and adjacent `**` so the delimiter
  becomes valid left/right-flanking (fixes `word**bold**word`).
- Strips whitespace tucked *inside* `**` delimiters (`** foo **` →
  `**foo**`).
- Closes an odd `\`\`\`` fence at end-of-stream so the tail is not
  rendered as one giant `<pre>` while the model is still writing.

## Anti-hallucination levers, ranked

From most to least effective in practice:

1. **Per-occurrence prompt with inline authoritative references.** Gemma
   stops inventing WCAG SCs when the exact list is in the prompt with a
   closing "use only these" instruction.
2. **Tools returning authoritative fields.** `get_finding_detail`
   returning the real `conformance` array is stronger than any system
   prompt directive.
3. **System prompt "cite only" rule + "call a tool if unsure"**. Reliable
   for Claude, partially effective for Gemma on free-form questions.
4. **Category glossary in the system prompt.** Prevents mustFix /
   goodToFix / needsReview being conflated.
5. **Formatting hints.** Improves readability but does not affect factual
   accuracy.

## When to update this doc

Update this document when you:

- Add or remove a tool (update the tool table).
- Change the shape of the "Ask about this" message (update the shape
  example).
- Switch providers or add a third provider (add a new subsection under
  "Provider strategy").
- Ship a chat-template artifact filter for a new token (add to the token
  list under Gemma).
- Change `MAX_INDEX_KB`, screenshot budget, or the tiered
  `contextSize` map (mention the new cap and reasoning).

Do NOT update it for wording tweaks that do not change intent (e.g.
rewording "must fix" → "must-fix"). Keep this file about *why* the
prompts look the way they do.
