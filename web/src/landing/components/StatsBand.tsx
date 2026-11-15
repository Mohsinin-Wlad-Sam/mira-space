import { useEffect, useState } from 'react'
import BackgroundImage from './BackgroundImage'
import { delay } from '../revealTiming'
import { useReveal } from '../useReveal'
import { stats, type Stat } from '../content'
import { prefersReducedMotion } from '../smoothScroll'
import { useSummary, type CensusSummary } from '../useSummary'
import './Sections.css'

const format = (n: number, decimals = 0) =>
  n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })


/** Live census numbers (same as the viewer's old intro), or null to keep the static set. */
function liveStats(_s: CensusSummary | null): Stat[] | null {
  // the figures of the first whole-sky pass are no longer shown: the verified catalogue's are (content.ts)
  return null
}

interface CountUpProps {
  value: number
  start: boolean
  decimals?: number
  duration?: number
}

function CountUp({ value, start, decimals = 0, duration = 1600 }: CountUpProps) {
  const [reduced] = useState(prefersReducedMotion)
  const [n, setN] = useState(reduced ? value : 0)

  useEffect(() => {
    if (!start || reduced) return
    let frame = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(eased * value)
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [start, value, duration, reduced])

  return <>{format(n, decimals)}</>
}

export default function StatsBand() {
  const [ref, visible] = useReveal<HTMLDListElement>(0.35)
  // the band answers "who is this for and how do we know": the impact figures of content.ts. The live census
  // numbers (billions of detections) stay available to the app's Method page; here they are only a fallback.
  const live = liveStats(useSummary())
  const items = stats.items.length ? stats.items : (live ?? [])

  return (
    <section className="panel panel--stats" aria-label="Who it is for, in numbers">
      <div className="panel__backdrop">
        <div className="panel__media">
          <BackgroundImage image={stats.image} />
        </div>
        <div className="panel__shade panel__shade--full" />
      </div>

      <dl ref={ref} className={`stats stats--${items.length} reveal-group ${visible ? 'is-visible' : ''}`}>
        {items.map((s, i) => (
          <div className="stat reveal-item" key={s.label} style={delay(i * 160)}>
            <dt className="stat__label">{s.label}</dt>
            <dd className="stat__value display">
              <span aria-hidden="true">
                <CountUp value={s.value} decimals={s.decimals} start={visible} />
                {s.suffix}
              </span>
              <span className="visually-hidden">
                {format(s.value, s.decimals)}
                {s.suffix}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
