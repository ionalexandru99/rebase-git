import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'sidecar',
    environment: 'node',
    globals: true,
    include: ['src/sidecar/**/*.test.{ts,tsx}'],
    minWorkers: 1,
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage/sidecar',
      include: ['src/sidecar/**']
    }
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared')
    }
  }
})
