import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

// Plain-JavaScript project: the Worker entry is src/index.js (no TypeScript).
export default defineConfig({
  plugins: [
    build({ entry: 'src/index.js' }),
    devServer({
      adapter,
      entry: 'src/index.js'
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true
  }
})
