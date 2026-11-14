import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two pages: the React landing at / and the Aladin sky viewer at /explore/.
// They are separate entries so their styles and scroll handling never mix.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { main: 'index.html', explore: 'explore/index.html' },
    },
  },
})
