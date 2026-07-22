import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fuzhou Mahjong',
        short_name: 'Mahjong',
        display: 'standalone',
        theme_color: '#166534',
        background_color: '#166534',
      },
    }),
  ],
})
