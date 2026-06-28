import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['development', 'browser'],
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  test: {
    name: 'renderer',
    environment: 'happy-dom',
    globals: true,
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage/renderer',
      include: ['src/renderer/**'],
    },
    server: {
      deps: {
        inline: [/react/, /@testing-library\/react/, /sonner/, /lucide-react/],
      },
    },
  },
})
