import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'sidecar',
    environment: 'node',
    globals: true,
    include: ['src/agent/**/*.test.{ts,tsx}', 'src/sidecar/**/*.test.{ts,tsx}'],
    minWorkers: 1,
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_VALUE_0: 'false'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage/sidecar',
      include: ['src/agent/**', 'src/sidecar/**']
    }
  },
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, './src/common'),
      '@shared': path.resolve(__dirname, './src/shared')
    }
  }
})
