import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'lenis/dist/lenis.css'
import './index.css'
import './overrides.css'
import App from './App'

// Old share links pointed the sky at /#ra=..&dec=..; the viewer now lives at /explore/.
if (/(^#|&)ra=/.test(location.hash)) location.replace('/explore/' + location.hash)

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
