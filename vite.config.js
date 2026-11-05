import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { stagingConfig } from './experiments/sync-lab/src/staging-config.js'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig(({ mode }) => {
  // 明示した検証ビルドだけ新Providerを選ぶ。通常配信は従来どおりで、二つの保存経路を同時に起動しない。
  const staging = mode === 'sync-staging'
  const lab = new URL('./experiments/sync-lab/', import.meta.url)
  const connection = staging ? stagingConfig(loadEnv('staging', fileURLToPath(lab), 'LAB_SUPABASE_')) : null
  const sessionClient = fileURLToPath(new URL('src/session-client.js', lab))
  const productSource = fileURLToPath(new URL('./src/', import.meta.url)).replaceAll('\\', '/')
  return {
  envPrefix: staging ? 'LAB_BROWSER_UNUSED_' : 'VITE_',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    ...(staging ? { __LAB_STAGING__: JSON.stringify(connection) } : {}),
  },
  resolve: { alias: [
    { find: '#outline-provider', replacement: staging ? fileURLToPath(new URL('src/app-outline-provider.jsx', lab)) : fileURLToPath(new URL('./src/Outliner.jsx', import.meta.url)) },
    ...(staging ? [{ find: /^loro-crdt$/, replacement: fileURLToPath(new URL('src/loro-runtime.js', lab)) }] : []),
  ] },
  plugins: [
    ...(staging ? [{ name: '検証先の同一SDKを使う', enforce: 'pre', resolveId(source, importer) {
      if (['./lib/supabase', './supabase', './lib/supabase.js', './supabase.js'].includes(source) && importer?.replaceAll('\\', '/').startsWith(productSource)) return sessionClient
    } }] : []),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: staging ? 'Task Space 検証' : 'Task Space',
        short_name: staging ? 'Task Space 検証' : 'Task Space',
        description: 'Notion-like project task manager',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // 圏外で新履歴を読むにもWASMが必要。HTML/JSだけの控えではPWAの再起動が止まる。
        globPatterns: [staging ? '**/*.{js,css,html,ico,png,svg,wasm}' : '**/*.{js,css,html,ico,png,svg}'],
        ...(staging ? { cacheId: 'taskspace-sync-staging', maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 } : {}),
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  }
})
