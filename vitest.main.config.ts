import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'main',
    environment: 'node',
    globals: true,
    include: ['src/main/**/*.test.{ts,tsx}'],
  },
})
