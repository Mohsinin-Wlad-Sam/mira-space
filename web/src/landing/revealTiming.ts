import type { CSSProperties } from 'react'

/** Inline style that sets the reveal delay custom property (--d), in ms. */
export const delay = (ms: number): CSSProperties => ({ ['--d' as string]: `${Math.round(ms)}ms` })

/** Time until a SplitText's last word starts moving — for sequencing what follows. */
export const splitDuration = (text: string, stagger = 70): number =>
  Math.max(0, text.split(/\s+/).filter(Boolean).length - 1) * stagger
