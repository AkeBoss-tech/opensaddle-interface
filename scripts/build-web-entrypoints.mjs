import { copyFile, mkdir } from 'node:fs/promises'

// Static hosts do not rewrite SPA routes. Publish real entry documents for the
// public entry and connection form, plus a fallback for other application URLs.
// Electron uses relative assets and must retain its single file:// entrypoint.
if (process.env.VITE_APP_BASE !== './') {
  for (const route of ['home', 'settings']) {
    await mkdir(`dist/${route}`, { recursive: true })
    await copyFile('dist/index.html', `dist/${route}/index.html`)
  }
  await copyFile('dist/index.html', 'dist/404.html')
}
