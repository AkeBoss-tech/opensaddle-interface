import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from /opensaddle-interface/
export default defineConfig({
  plugins: [react()],
  base: '/opensaddle-interface/',
  build: {
    rollupOptions: {
      // The desktop renderer remains the default entrypoint.  The separate
      // browser client is intentionally a second, static entrypoint so it can
      // be deployed without Electron while sharing the control-plane API.
      input: {
        renderer: resolve(import.meta.dirname, 'index.html'),
        web: resolve(import.meta.dirname, 'web/index.html'),
      },
    },
  },
})
