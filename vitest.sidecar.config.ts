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
    // Git for Windows defaults core.autocrlf=true, which rewrites checkouts to CRLF and breaks
    // every fixture that round-trips '\n' content through a git operation. Pin it for all git
    // children — tests spawn git directly and through the sidecar's simple-git.
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_VALUE_0: 'false'
    },
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
