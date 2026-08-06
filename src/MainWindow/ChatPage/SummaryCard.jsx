import React from 'react'

const fmt = (v, fallback = '—') =>
  v === null || v === undefined || v === '' ? fallback : v

const SummaryCard = ({ summary }) => {
  if (!summary) return null

  const {
    siteName,
    urlScanned,
    startTime,
    viewport,
    wcagPassPercentage,
    totalPagesScanned,
    totalPagesNotScanned,
    mustFixRules,
    mustFixOccurrences,
    goodToFixRules,
    goodToFixOccurrences,
    needsReviewRules,
    needsReviewOccurrences,
    topRules = [],
    topPages = [],
  } = summary

  return (
    <div className="summary-card" role="region" aria-label="Scan summary">
      <div className="summary-card-header">
        <h2>{fmt(siteName || urlScanned)}</h2>
        <div className="summary-card-meta">
          <span>{fmt(urlScanned)}</span>
          {startTime && <span> · {fmt(startTime)}</span>}
          {viewport && <span> · {fmt(viewport)}</span>}
        </div>
      </div>

      <div className="summary-card-stats">
        <div className="stat">
          <div className="stat-label">WCAG Pass</div>
          <div className="stat-value">
            {typeof wcagPassPercentage === 'number' && Number.isFinite(wcagPassPercentage)
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

      {topRules.length > 0 && (
        <div className="summary-card-section">
          <h3>Top must-fix rules</h3>
          <ol>
            {topRules.map((r, i) => (
              <li key={i}>
                <strong>{r.rule}</strong>
                {r.description ? ` — ${r.description}` : ''}
                <span className="rule-meta">
                  {' '}({r.totalItems} occurrence{r.totalItems === 1 ? '' : 's'}
                  {Array.isArray(r.conformance) && r.conformance.length > 0
                    ? `, WCAG ${r.conformance.join(', ')}`
                    : ''}
                  )
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {topPages.length > 0 && (
        <div className="summary-card-section">
          <h3>Top pages by issue count</h3>
          <ol>
            {topPages.map((p, i) => (
              <li key={i}>
                <span className="page-title">{fmt(p.pageTitle || p.url)}</span>
                <span className="rule-meta"> — {p.totalIssues} issues</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

export default SummaryCard
