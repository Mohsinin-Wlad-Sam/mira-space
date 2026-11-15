import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
// @ts-expect-error plain JS module shared with the production proxy
import { handle, handleAnswers } from './server/assistant.mjs'

// The assistant's endpoint during development and `vite preview`: the model key is read from web/.env.local
// (never committed) and stays on the server side. In production the same handler runs in deploy/assistant-proxy.mjs.
const proc = (globalThis as any).process as { env: Record<string, string>; cwd: () => string }
function assistant(env: Record<string, string>): Plugin {
  // (a hook that returns a function would be run again by Vite after its own middlewares: return nothing)
  const use = (server: { middlewares: { use: (path: string, fn: (req: any, res: any) => void) => unknown } }): void => { server.middlewares.use('/api/assistant', (req, res) => { handle(req, res, { ...proc.env, ...env }) })
    // visitors' answers on the map ("take part"): kept in a file beside the project during development
    server.middlewares.use('/api/answers', (req, res) => { handleAnswers(req, res, { MIRA_ANSWERS_FILE: 'mira-answers.jsonl.local', ...proc.env, ...env }) }) }
  return { name: 'mira-assistant', configureServer: use, configurePreviewServer: use }
}

// Four pages: the React landing at /, the observatory at /explore/, the documentation at /docs/ and the slide deck at /deck/.
// They are separate entries so their styles and scroll handling never mix.
export default defineConfig(({ mode }) => ({
  plugins: [react(), assistant(loadEnv(mode, proc.cwd(), 'MIRA_'))],
  build: {
    rollupOptions: {
      input: { main: 'index.html', explore: 'explore/index.html', docs: 'docs/index.html', deck: 'deck/index.html', film: 'film/index.html' },
    },
  },
}))
