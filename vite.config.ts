import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const GITHUB_PAGES_BASE = '/hisense-mvp/';
const PWA_STATIC_ASSETS = [
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'icons/apple-touch-icon-180x180.png',
  'fonts/space-grotesk-latin.woff2',
];

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? GITHUB_PAGES_BASE : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      injectRegister: false,
      registerType: 'prompt',
      manifest: false,
      includeAssets: PWA_STATIC_ASSETS,
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 35 * 1024 * 1024,
        globPatterns: ['**/*.{html,js,css,png,jpg,jpeg,svg,ico,webmanifest,woff2,glb,wasm,task}'],
        globIgnores: [
          '**/.DS_Store',
          '**/README.md',
          '**/jersey_mexico_rig.glb',
          '**/hisense-football-stadium-2026.jpg',
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/assets/backgrounds/') && url.pathname.endsWith('.mp4'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'background-videos',
              expiration: {
                maxEntries: 3,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
