import { useEffect, useState, type ElementType } from 'react'
import { prefersReducedMotion } from '../smoothScroll'
import { delay } from '../revealTiming'

interface SplitTextProps {
  text: string
  as?: ElementType
  id?: string
  className?: string
  /** Delay before the first word, in ms. */
  delay?: number
  /** Gap between words, in ms. */
  stagger?: number
}

/**
 * Headline whose words rise out of a mask one by one when the surrounding
 * `.reveal-group` becomes visible. The real text stays in the heading (hidden
 * visually) so screen readers and aria-labelledby read it normally.
 */
export function SplitText({ text, as: Tag = 'h2', id, className, delay: start = 0, stagger = 70 }: SplitTextProps) {
  const words = text.split(/\s+/).filter(Boolean)
  return (
    <Tag id={id} className={className}>
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true">
        {words.map((word, i) => (
          <span key={i}>
            <span className="rt-word">
              <span className="rt-inner" style={delay(start + i * stagger)}>
                {word}
              </span>
            </span>
            {i < words.length - 1 ? ' ' : null}
          </span>
        ))}
      </span>
    </Tag>
  )
}

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/'

interface ScrambleProps {
  text: string
  /** Starts decoding when this becomes true. */
  start: boolean
  /** Delay before decoding begins, in ms. */
  delay?: number
  duration?: number
}

/**
 * Mono label that "decodes" from random glyphs into its real text,
 * left to right. Shows the final text immediately under reduced motion.
 */
export function Scramble({ text, start, delay: wait = 0, duration = 900 }: ScrambleProps) {
  const [reduced] = useState(prefersReducedMotion)
  const [out, setOut] = useState(text)

  useEffect(() => {
    if (!start || reduced) return
    let frame = 0
    let t0 = 0
    const tick = (now: number) => {
      if (!t0) t0 = now + wait
      const p = Math.max(0, Math.min(1, (now - t0) / duration))
      const settled = Math.floor(p * text.length)
      let next = ''
      for (let i = 0; i < text.length; i++) {
        const ch = text[i] ?? ''
        next += i < settled || ch === ' ' || ch === '·' ? ch : (GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? ch)
      }
      setOut(next)
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [start, reduced, text, wait, duration])

  return (
    <>
      <span className="visually-hidden">{text}</span>
      <span className="scramble" aria-hidden="true">
        {out}
      </span>
    </>
  )
}
