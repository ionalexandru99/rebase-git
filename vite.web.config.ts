import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { injectContentSecurityPolicyMeta } from './src/main/app/csp'

export default defineConfig({
  root: path.resolve('src/web'),
  plugins: [
    {
      name: 'rebase-web-csp',
      apply: 'build',
      transformIndexHtml: injectContentSecurityPolicyMeta
    },
    tailwindcss(),
    react()
  ],
  publicDir: path.resolve('src/renderer/public'),
  worker: {
    format: 'es'
  },
  resolve: {
    alias: {
      '@': path.resolve('src/renderer'),
      '@common': path.resolve('src/common'),
      '@shared': path.resolve('src/shared')
    }
  },
  build: {
    outDir: path.resolve('out/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve('src/web/index.html')
      },
      onwarn(warning, defaultHandler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return
        }
        if (warning.code === 'SOURCEMAP_ERROR' && warning.message?.includes('use client')) {
          return
        }
        defaultHandler(warning)
      }
    }
  }
})
