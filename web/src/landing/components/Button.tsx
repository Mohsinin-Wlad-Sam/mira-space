import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './Button.css'

function Arrow() {
  return (
    <svg className="btn__arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1 8h13M9 3l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type ButtonProps = {
  children: ReactNode
  className?: string
} & ({ to: string; href?: never } | { href: string; to?: never })

/**
 * Outlined SpaceX-style button. Pass `to` for an in-app route or `href` for a
 * link: site pages ("/explore/…") open in the same tab, external links in a new one.
 */
export default function Button({ to, href, children, className = '' }: ButtonProps) {
  const cls = `btn ${className}`.trim()
  const inner = (
    <>
      <span>{children}</span>
      <Arrow />
    </>
  )

  if (to !== undefined) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    )
  }
  if (href.startsWith('/')) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    )
  }
  return (
    <a href={href} className={cls} target="_blank" rel="noopener noreferrer">
      {inner}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  )
}
