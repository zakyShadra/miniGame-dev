import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tipe shared/ tinggal di luar root app/ (../shared); izinkan Vite
  // dev server melayaninya. Build tidak butuh ini (Rollup baca langsung).
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
