import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    globals: true,
    include: ['src/server/**/*.test.{ts,tsx}', 'src/common/__tests__/runtime-dependencies.test.ts']
  },
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, './src/common'),
      '@shared': path.resolve(__dirname, './src/shared')
    }
  }
})
