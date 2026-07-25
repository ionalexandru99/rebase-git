import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'main-integration',
    environment: 'node',
    globals: true,
    include: ['src/main/**/*.integration.test.{ts,tsx}'],
    testTimeout: 20_000,
    hookTimeout: 20_000
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared')
    }
  }
})
