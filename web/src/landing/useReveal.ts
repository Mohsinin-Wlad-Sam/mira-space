import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Returns [ref, visible]. `visible` flips to true the first time the element
 * scrolls into view, and stays true.
 */
export function useReveal<T extends Element = HTMLDivElement>(
  threshold = 0.2,
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible, threshold])

  return [ref, visible]
}
