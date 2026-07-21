import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from /opensaddle-interface/
export default defineConfig({
  plugins: [react()],
  base: '/opensaddle-interface/',
})
