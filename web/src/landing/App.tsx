import { useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import { scrollToTarget, startSmoothScroll } from './smoothScroll'

/**
 * Owns all scrolling: starts smooth scrolling, scrolls to #hash targets after
 * navigation (smoothly), and jumps to the top on a page change.
 */
function ScrollManager() {
  const { pathname, hash, key } = useLocation()
  const firstRun = useRef(true)
  const lastPath = useRef(pathname)

  // Declared first so Lenis exists before the hash effect below runs.
  useEffect(() => startSmoothScroll(), [])

  useEffect(() => {
    const isFirst = firstRun.current
    const pageChanged = lastPath.current !== pathname
    firstRun.current = false
    lastPath.current = pathname

    if (pageChanged) scrollToTarget(0, true)
    if (!hash) {
      // Same page, no hash (e.g. logo clicked while on "/"): glide back to the top.
      if (!isFirst && !pageChanged) scrollToTarget(0)
      return
    }
    // Wait a frame so the target section is rendered.
    const id = decodeURIComponent(hash.slice(1))
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (el) scrollToTarget(el, isFirst)
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, hash, key]) // key: re-scroll when the same link is clicked again

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  )
}
