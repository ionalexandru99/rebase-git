import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve('src/renderer')
      }
    },
    build: {
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
          if (warning.code === 'SOURCEMAP_ERROR' && warning.message?.includes('use client')) return
          defaultHandler(warning)
        }
      }
    }
  }
})
