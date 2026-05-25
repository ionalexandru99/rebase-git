import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'renderer',
    environment: 'jsdom',
    globals: true,
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'src/renderer/solid/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
})
