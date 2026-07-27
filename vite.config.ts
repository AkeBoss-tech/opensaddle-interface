import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from /opensaddle-interface/
export default defineConfig({
  plugins: [react()],
  // The Electron bundle is loaded from `file://`, so it needs relative asset
  // URLs. Web deployments retain the GitHub Pages base unless overridden.
  base: process.env.VITE_APP_BASE ?? '/opensaddle-interface/',
})
