import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CensusStatus from './CensusStatus'
import { navLinks, viewer } from '../content'
import { setScrollLocked } from '../smoothScroll'
import './Header.css'

export function Wordmark() {
  return (
    <span className="wordmark" aria-label="Mira">
      {/* Transparent PNG (black keyed out), so it sits on any photo. */}
      <img className="wordmark__mark" src="/brand/mira-mark.png" width={59} height={32} alt="" />
      <span className="wordmark__text" aria-hidden="true">
        MIRA
      </span>
    </span>
  )
}

export default function Header() {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Hide the bar while scrolling down, reveal it when scrolling up.
  useEffect(() => {
    let lastY = window.scrollY
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = window.scrollY
        setScrolled(y > 40)
        setHidden(y > 160 && y > lastY)
        lastY = y
        ticking = false
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Drawer: lock page scroll, close on Escape, keep focus inside.
  useEffect(() => {
    const drawer = drawerRef.current
    if (!open || !drawer) return
    const toggle = toggleRef.current
    const focusables = () => [...drawer.querySelectorAll<HTMLElement>('a, button')]
    focusables()[0]?.focus()
    document.body.style.overflow = 'hidden'
    setScrollLocked(true)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      setScrollLocked(false)
      toggle?.focus()
    }
  }, [open])

  const close = () => setOpen(false)
  const headerCls = ['site-header', scrolled && 'is-scrolled', hidden && !open && 'is-hidden']
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <header className={headerCls}>
        <nav className="site-nav" aria-label="Main">
          <Link to="/" className="site-nav__brand" aria-label="Mira home">
            <Wordmark />
          </Link>

          <ul className="site-nav__links">
            {navLinks.map((l) => (
              <li key={l.href}>
                <Link to={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>

          <a href={viewer.home} className="site-nav__status">
            <CensusStatus className="site-nav__status-value" />
          </a>

          <button
            ref={toggleRef}
            type="button"
            className={`site-nav__toggle ${open ? 'is-open' : ''}`}
            aria-expanded={open}
            aria-controls="site-drawer"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </nav>
      </header>

      <div className={`drawer-overlay ${open ? 'is-open' : ''}`} onClick={close} aria-hidden="true" />
      <aside
        id="site-drawer"
        ref={drawerRef}
        className={`drawer ${open ? 'is-open' : ''}`}
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open}
        data-lenis-prevent
      >
        <button type="button" className="drawer__close" aria-label="Close menu" onClick={close}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <a href={viewer.home} className="drawer__status">
          <CensusStatus />
        </a>

        <ul className="drawer__links">
          {navLinks.map((l) => (
            <li key={l.href}>
              <Link to={l.href} onClick={close}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </>
  )
}
