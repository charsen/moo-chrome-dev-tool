import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import { resolve } from 'node:path'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig({
  plugins: [vue(), crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
    hmr: { port: 5273 }
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, 'src/offscreen/index.html')
      }
    }
  }
})
