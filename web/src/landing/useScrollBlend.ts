import { useEffect } from 'react'

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
/** Smootherstep: zero velocity and acceleration at both ends — no visible "start" or "stop". */
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** The dissolve runs while a section's top edge travels from FROM to TO (fractions of viewport height). */
const FROM = 1.0
const TO = 0.05
/** Layers this far below the viewport are shown early so their photo has loaded before it fades in. */
const PRELOAD = 1.5

/**
 * Cross-dissolves the fixed section backdrops (`.panel__backdrop`) as you
 * scroll: each section's photo + shade fades in over the previous one while
 * the section rises into view. Scroll-linked (it only moves when the user
 * scrolls), so it also runs under reduced motion. Only opacity changes — the
 * photos' size and crop are untouched.
 */
export function useScrollBlend(): void {
  useEffect(() => {
    const layers = [...document.querySelectorAll<HTMLElement>('.panel > .panel__backdrop')]
    if (layers.length < 2) return

    let frame = 0
    const update = () => {
      frame = 0
      const vh = window.innerHeight
      const progress = layers.map((layer, i) => {
        if (i === 0) return 1
        const top = (layer.parentElement ?? layer).getBoundingClientRect().top / vh
        return smoother(clamp01((FROM - top) / (FROM - TO)))
      })

      layers.forEach((layer, i) => {
        const top = (layer.parentElement ?? layer).getBoundingClientRect().top / vh
        const bottom = (layer.parentElement ?? layer).getBoundingClientRect().bottom / vh
        const coveredByNext = (progress[i + 1] ?? 0) >= 1
        const near = top < FROM + PRELOAD && bottom > -1.5
        const visible = !coveredByNext && (i === 0 || near)
        // display: none (not visibility) so far-off photos aren't downloaded yet
        layer.style.display = visible ? 'block' : 'none'
        layer.style.opacity = (progress[i] ?? 1).toFixed(4)
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      for (const layer of layers) {
        layer.style.opacity = ''
        layer.style.display = ''
      }
    }
  }, [])
}
