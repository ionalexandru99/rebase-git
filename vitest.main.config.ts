import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'main',
    environment: 'node',
    globals: true,
    include: [
      'src/main/**/*.test.{ts,tsx}',
      'src/electron/**/*.test.{ts,tsx}',
      'src/shared/**/*.test.{ts,tsx}',
      'scripts/**/*.test.mjs',
    ],
    exclude: ['src/main/**/*.integration.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage/main',
      include: ['src/main/**', 'src/shared/**'],
    },
  },
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, './src/common'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
})
