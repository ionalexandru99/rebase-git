import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    globals: true,
    include: [
      'tests/agent-connection/contract*.test.ts',
      'tests/agent-connection/server*.test.ts',
      'tests/architecture/runtime-dependencies.test.ts'
    ],
    globalSetup: ['tests/agent-connection/server-global-setup.ts'],
    minWorkers: 1,
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 60_000
  },
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, './src/common'),
      '@shared': path.resolve(__dirname, './src/shared')
    }
  }
})
