import Lenis from 'lenis'

/**
 * Site-wide smooth (inertia) scrolling via Lenis. Lenis keeps native scroll
 * position, so window.scrollY, IntersectionObserver, the fixed header and lazy
 * images all keep working.
 *
 * - Wheel/trackpad scrolling is smoothed; touch scrolling stays native.
 * - Not started at all when the user prefers reduced motion.
 * - Reference-counted so React StrictMode's double-mount in dev never leaves
 *   two instances running.
 */
let lenis: Lenis | null = null
let users = 0

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function startSmoothScroll(): () => void {
  if (prefersReducedMotion()) return () => {}
  users += 1
  if (!lenis) {
    lenis = new Lenis({
      autoRaf: true,
      lerp: 0.09,
      wheelMultiplier: 1,
      smoothWheel: true,
      syncTouch: false,
    })
  }
  return () => {
    users -= 1
    if (users === 0 && lenis) {
      lenis.destroy()
      lenis = null
    }
  }
}

export function getLenis(): Lenis | null {
  return lenis
}

/** Scroll to an element or y-position — smooth via Lenis when running, native otherwise. */
export function scrollToTarget(target: Element | number, immediate = false): void {
  if (lenis) {
    // The page height may have just changed (route change) — refresh Lenis's
    // cached scroll limit so the target isn't clamped to the old page length.
    lenis.resize()
    lenis.scrollTo(target, { immediate, force: true, duration: immediate ? undefined : 1.4 })
    return
  }
  if (typeof target === 'number') window.scrollTo(0, target)
  else target.scrollIntoView()
}

/** Pause/resume page scrolling (e.g. while a modal drawer is open). */
export function setScrollLocked(locked: boolean): void {
  if (!lenis) return
  if (locked) lenis.stop()
  else lenis.start()
}
