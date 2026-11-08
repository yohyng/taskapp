import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { stagingConfig } from './experiments/sync-lab/src/staging-config.js'
import { releaseConfig } from './experiments/sync-lab/src/release-config.js'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig(({ mode }) => {
  // 明示した切替・検証ビルドだけ新Providerを選ぶ。通常配信で二つの保存経路を同時に起動しない。
  const penPreview = mode === 'pen-preview'
  const staging = mode === 'sync-staging'
  const release = mode === 'sync-release'
  const newSync = staging || release
  const lab = new URL('./experiments/sync-lab/', import.meta.url)
  const connection = release ? releaseConfig(loadEnv('production', fileURLToPath(new URL('.', import.meta.url)), 'VITE_'))
    : staging ? stagingConfig(loadEnv('staging', fileURLToPath(lab), 'LAB_SUPABASE_')) : null
  const sessionClient = fileURLToPath(new URL('src/session-client.js', lab))
  const productSource = fileURLToPath(new URL('./src/', import.meta.url)).replaceAll('\\', '/')
  return {
  ...(penPreview ? { build: { rollupOptions: { input: fileURLToPath(new URL('./pen-lab.html', import.meta.url)) } } } : {}),
  envPrefix: newSync ? 'LAB_BROWSER_UNUSED_' : 'VITE_',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    ...(newSync ? { __LAB_STAGING__: JSON.stringify(connection) } : {}),
  },
  resolve: { alias: [
    { find: '#outline-provider', replacement: newSync ? fileURLToPath(new URL('src/app-outline-provider.jsx', lab)) : fileURLToPath(new URL('./src/Outliner.jsx', import.meta.url)) },
    ...(newSync ? [{ find: /^loro-crdt$/, replacement: fileURLToPath(new URL('src/loro-runtime.js', lab)) }] : []),
  ] },
  plugins: [
    ...(newSync ? [{ name: '接続先の同一SDKを使う', enforce: 'pre', resolveId(source, importer) {
      if (['./lib/supabase', './supabase', './lib/supabase.js', './supabase.js'].includes(source) && importer?.replaceAll('\\', '/').startsWith(productSource)) return sessionClient
    } }] : []),
    react(),
    tailwindcss(),
    ...(!penPreview ? [VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: staging ? 'fragments 検証' : 'fragments',
        short_name: staging ? 'fragments 検証' : 'fragments',
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
        globPatterns: [newSync ? '**/*.{js,css,html,ico,png,svg,wasm}' : '**/*.{js,css,html,ico,png,svg}'],
        ...(newSync ? { cacheId: staging ? 'taskspace-sync-staging' : 'taskspace-sync', maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 } : {}),
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
    })] : [])
  ],
  }
})
