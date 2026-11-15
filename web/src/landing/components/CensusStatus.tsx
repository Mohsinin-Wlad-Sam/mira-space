/** Header shortcut into the app: a live dot, "Open the app", and the name of its first screen. */
export default function CensusStatus({ className = '' }: { className?: string }) {
  return (
    <>
      <span className="census-status__label">
        <span className="census-status__dot" aria-hidden="true" />
        <span className="census-status__text">Open the app</span>
      </span>
      <span className={`census-status__value ${className}`.trim()}>The map</span>
    </>
  )
}
