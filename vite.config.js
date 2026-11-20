import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Single source of truth for the deployment path.
// GitHub Pages project sites are served from /<repository-name>/.
// VITE_BASE_PATH can override this for other hosting targets.
const base =
  process.env.VITE_BASE_PATH ||
  (process.env.GITHUB_ACTIONS ? '/football-Mind/' : '/');

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'MatchMind',
        short_name: 'MatchMind',
        description:
          'Football match predictions and match intelligence using Poisson-family models, real historical data and live scores.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0a0f1a',
        theme_color: '#0a0f1a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // matches.json is about 4 MB, so raise the precache limit.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff,woff2}'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Live scores must never be served stale from the cache.
            urlPattern: /^https:\/\/www\.thesportsdb\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // KaTeX is loaded from a CDN; cache it so maths still renders offline.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cdn-katex',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
