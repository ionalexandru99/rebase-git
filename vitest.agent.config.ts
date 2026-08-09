import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'agent',
    environment: 'node',
    globals: true,
    include: [
      'tests/agent-connection/agent/**/*.test.ts',
      'tests/environment-identity/agent/**/*.test.ts'
    ],
    minWorkers: 1,
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage/agent',
      include: ['src/agent/**']
    }
  },
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, './src/common'),
      '@shared': path.resolve(__dirname, './src/shared')
    }
  }
})
