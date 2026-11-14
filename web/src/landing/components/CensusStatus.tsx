import { tilesLabel, useSummary } from '../useSummary'

/** "Census live · 1,234 / 12,288 tiles" — or a plain "Sky viewer · Open" before the feed loads. */
export default function CensusStatus({ className = '' }: { className?: string }) {
  const s = useSummary()
  return (
    <>
      <span className="census-status__label">
        {s && <span className="census-status__dot" aria-hidden="true" />}
        <span className="census-status__text">{s ? 'Census live' : 'Sky viewer'}</span>
      </span>
      <span className={`census-status__value ${className}`.trim()}>{s ? tilesLabel(s) : 'Open'}</span>
    </>
  )
}
