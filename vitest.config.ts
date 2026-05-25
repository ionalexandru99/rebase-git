import path from 'node:path'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ['development', 'browser'],
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  test: {
    name: 'renderer',
    environment: 'jsdom',
    globals: true,
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    server: {
      deps: {
        inline: [/solid-js/, /@solidjs/, /@kobalte/, /solid-sonner/, /corvu/, /lucide-solid/],
      },
    },
  },
})
