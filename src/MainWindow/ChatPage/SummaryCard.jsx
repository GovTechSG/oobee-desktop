import { useEffect, useState } from 'react'
import { handleClickLink } from '../../common/constants'

const fmt = (v, fallback = '—') =>
  v === null || v === undefined || v === '' ? fallback : v

const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '')

// Loads occurrences for a single rule and lets the user page through them.
// Screenshot data URIs, if present, are rendered inline; each occurrence has an
// "Ask about this one" button that hands off to the parent chat.
const OccurrenceBrowser = ({ category, rule, fetchFindingDetail, onAskAboutOccurrence }) => {
  const [state, setState] = useState({ loading: true, error: null, payload: null })
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, payload: null })
    setIndex(0)
    ;(async () => {
      try {
        const res = await fetchFindingDetail(category, rule.rule)
        if (cancelled) return
        if (!res?.ok) {
          setState({ loading: false, error: res?.error || 'Failed to load occurrences', payload: null })
          return
        }
        setState({ loading: false, error: null, payload: res })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.message, payload: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [category, rule.rule, fetchFindingDetail])

  if (state.loading) {
    return <div className="occurrence-browser occurrence-browser-loading">Loading occurrences…</div>
  }
  if (state.error) {
    return (
      <div className="occurrence-browser occurrence-browser-error" role="alert">
        {state.error}
      </div>
    )
  }
  const occurrences = state.payload?.occurrences || []
  if (occurrences.length === 0) {
    return <div className="occurrence-browser">No occurrence data available for this rule.</div>
  }
  const current = occurrences[index]
  const total = state.payload.totalOccurrences || occurrences.length
  const shown = occurrences.length
  const displayIndex = index + 1

  const prev = () => setIndex((i) => Math.max(0, i - 1))
  const next = () => setIndex((i) => Math.min(shown - 1, i + 1))

  return (
    <div className="occurrence-browser">
      <div className="occurrence-browser-toolbar">
        <button
          type="button"
          className="occurrence-nav"
          onClick={prev}
          disabled={index === 0}
          aria-label="Previous occurrence"
        >
          ‹
        </button>
        <span className="occurrence-counter" aria-live="polite">
          {displayIndex} / {shown}
          {state.payload.truncated ? ` of ${total}` : ''}
        </span>
        <button
          type="button"
          className="occurrence-nav"
          onClick={next}
          disabled={index >= shown - 1}
          aria-label="Next occurrence"
        >
          ›
        </button>
        <button
          type="button"
          className="occurrence-ask"
          onClick={() =>
            onAskAboutOccurrence({
              rule: state.payload.rule,
              description: state.payload.description,
              category: state.payload.category,
              conformance: state.payload.conformance,
              axeImpact: state.payload.axeImpact,
              helpUrl: state.payload.helpUrl,
              occurrence: current,
              index,
            })
          }
        >
          Ask the model about this
        </button>
      </div>

      <dl className="occurrence-fields">
        {(current.pageTitle || current.url) && (
          <>
            <dt>Page</dt>
            <dd>
              {current.pageTitle && <span className="occurrence-page-title">{current.pageTitle}</span>}
              {current.url && (
                <span className="occurrence-page-url">
                  {current.pageTitle ? ' — ' : ''}
                  <a href={current.url} onClick={(e) => handleClickLink(e, current.url)}>
                    {current.url}
                  </a>
                </span>
              )}
            </dd>
          </>
        )}
        {current.xpath && (
          <>
            <dt>XPath</dt>
            <dd>
              <code className="occurrence-xpath">{current.xpath}</code>
            </dd>
          </>
        )}
        {current.message && (
          <>
            <dt>Message</dt>
            <dd>{current.message}</dd>
          </>
        )}
        {current.html && (
          <>
            <dt>Snippet</dt>
            <dd>
              <pre className="occurrence-snippet">
                <code>{truncate(current.html, 800)}</code>
              </pre>
            </dd>
          </>
        )}
        {current.screenshotDataUri && (
          <>
            <dt>Screenshot</dt>
            <dd>
              <img
                className="occurrence-screenshot"
                src={current.screenshotDataUri}
                alt={`Screenshot of occurrence ${displayIndex}${current.url ? ` on ${current.url}` : ''}`}
                loading="lazy"
              />
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

const SummaryCard = ({
  summary,
  onAskAboutRule,
  onAskAboutOccurrence,
  fetchFindingDetail,
  detailsOpen,
  onDetailsToggle,
}) => {
  const [browseOpenKey, setBrowseOpenKey] = useState(null)

  if (!summary) return null

  const {
    siteName,
    urlScanned,
    startTime,
    viewport,
    wcagPassPercentage,
    wcagChecksPassed,
    wcagChecksTotal,
    totalPagesScanned,
    totalPagesNotScanned,
    mustFixRules,
    mustFixOccurrences,
    goodToFixRules,
    goodToFixOccurrences,
    needsReviewRules,
    needsReviewOccurrences,
    topRulesByCategory = {},
    topPages = [],
  } = summary

  const ruleCategories = [
    { key: 'mustFix', title: 'Must Fix' },
    { key: 'goodToFix', title: 'Good to Fix' },
    { key: 'needsReview', title: 'Manual Review Required' },
  ]
  const hasAnyRules = ruleCategories.some(
    (c) => Array.isArray(topRulesByCategory[c.key]) && topRulesByCategory[c.key].length > 0,
  )

  const toggleBrowse = (cat, rule) => {
    const key = `${cat}::${rule.rule}`
    setBrowseOpenKey((k) => (k === key ? null : key))
  }

  return (
    <div className="summary-card" role="region" aria-label="Scan summary">
      <div className="summary-card-header">
        <h2>{fmt(siteName || urlScanned)}</h2>
        <div className="summary-card-meta">
          {urlScanned ? (
            <a href={urlScanned} onClick={(e) => handleClickLink(e, urlScanned)}>
              {fmt(urlScanned)}
            </a>
          ) : (
            <span>{fmt(urlScanned)}</span>
          )}
          {startTime && <span> · {fmt(startTime)}</span>}
          {viewport && <span> · {fmt(viewport)}</span>}
        </div>
      </div>

      <div className="summary-card-stats">
        <div className="stat">
          <div className="stat-label">WCAG Score</div>
          <div className="stat-value">
            {Number.isFinite(wcagChecksPassed) && Number.isFinite(wcagChecksTotal)
              ? `${wcagChecksPassed} / ${wcagChecksTotal}`
              : typeof wcagPassPercentage === 'number' && Number.isFinite(wcagPassPercentage)
                ? `${wcagPassPercentage.toFixed(1)}%`
                : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Pages Scanned</div>
          <div className="stat-value">
            {fmt(totalPagesScanned, 0)}
            {totalPagesNotScanned ? (
              <span className="stat-sub"> ({totalPagesNotScanned} skipped)</span>
            ) : null}
          </div>
        </div>
        <div className="stat stat-must-fix">
          <div className="stat-label">Must Fix</div>
          <div className="stat-value">{fmt(mustFixRules, 0)}</div>
          <div className="stat-sub">{fmt(mustFixOccurrences, 0)} occurrences</div>
        </div>
        <div className="stat stat-good-to-fix">
          <div className="stat-label">Good to Fix</div>
          <div className="stat-value">{fmt(goodToFixRules, 0)}</div>
          <div className="stat-sub">{fmt(goodToFixOccurrences, 0)} occurrences</div>
        </div>
        <div className="stat stat-needs-review">
          <div className="stat-label">Needs Review</div>
          <div className="stat-value">{fmt(needsReviewRules, 0)}</div>
          <div className="stat-sub">{fmt(needsReviewOccurrences, 0)} occurrences</div>
        </div>
      </div>

      {(hasAnyRules || topPages.length > 0) && (
        <details
          className="summary-card-section summary-card-details"
          open={detailsOpen}
          onToggle={(e) => {
            if (onDetailsToggle) onDetailsToggle(e.currentTarget.open)
          }}
        >
          <summary>Issue details</summary>

          {hasAnyRules && (
            <div className="summary-card-rules">
              <h4 className="details-subhead">Top rules</h4>
              {ruleCategories.map(({ key, title }) => {
                const rules = Array.isArray(topRulesByCategory[key])
                  ? topRulesByCategory[key]
                  : []
                if (rules.length === 0) return null
                return (
                  <div key={key} className={`rule-group rule-group-${key}`}>
                    <h4>{title}</h4>
                    <ol>
                      {rules.map((r, i) => {
                        const rowKey = `${key}::${r.rule}`
                        const isOpen = browseOpenKey === rowKey
                        return (
                          <li key={i}>
                            <div className="rule-row">
                              {onAskAboutRule ? (
                                <button
                                  type="button"
                                  className="rule-chip"
                                  onClick={() => onAskAboutRule(r)}
                                  title={`Ask about ${r.rule}`}
                                >
                                  {r.rule}
                                </button>
                              ) : (
                                <strong>{r.rule}</strong>
                              )}
                              {fetchFindingDetail && (
                                <button
                                  type="button"
                                  className={`rule-browse-toggle${isOpen ? ' is-open' : ''}`}
                                  onClick={() => toggleBrowse(key, r)}
                                  aria-expanded={isOpen}
                                >
                                  {isOpen ? '▾ Hide occurrences' : '▸ Browse occurrences'}
                                </button>
                              )}
                              {r.description ? (
                                <span className="rule-description"> — {r.description}</span>
                              ) : null}
                              <span className="rule-meta">
                                {' '}({r.totalItems} occurrence{r.totalItems === 1 ? '' : 's'}
                                {Array.isArray(r.conformance) && r.conformance.length > 0
                                  ? `, WCAG ${r.conformance.join(', ')}`
                                  : ''}
                                )
                              </span>
                            </div>
                            {isOpen && fetchFindingDetail && (
                              <OccurrenceBrowser
                                category={key}
                                rule={r}
                                fetchFindingDetail={fetchFindingDetail}
                                onAskAboutOccurrence={onAskAboutOccurrence}
                              />
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )
              })}
            </div>
          )}

          {topPages.length > 0 && (
            <div className="summary-card-pages">
              <h4 className="details-subhead">Top pages by issue count</h4>
              <ol>
                {topPages.map((p, i) => (
                  <li key={i}>
                    {p.url ? (
                      <a className="page-title" href={p.url} onClick={(e) => handleClickLink(e, p.url)}>
                        {fmt(p.pageTitle || p.url)}
                      </a>
                    ) : (
                      <span className="page-title">{fmt(p.pageTitle || p.url)}</span>
                    )}
                    <span className="rule-meta"> — {p.totalIssues} issues</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </details>
      )}
    </div>
  )
}

export default SummaryCard
