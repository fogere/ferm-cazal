import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'Ferme Stinglhamber',
        short_name: 'Ferme',
        description: 'Gestion de la ferme Stinglhamber',
        theme_color: '#1A4731',
        background_color: '#F8F4EE',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // Icônes PNG requises par Chrome Android pour activer "Installer l'app".
        // Sans PNG 192 + 512, l'event beforeinstallprompt ne se déclenche pas.
        icons: [
          { src: 'icons/farm-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/farm-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/farm-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/farm-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/farm-icon.svg',     sizes: 'any',     type: 'image/svg+xml' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  build: {
    target: 'es2015',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('firebase')) return 'firebase'
          if (id.includes('leaflet') || id.includes('react-leaflet')) return 'map'
        },
      },
    },
  },
})
