import { randomUUID } from 'node:crypto'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import packageJson from './package.json'

const rendererBuildId = randomUUID()

function rebaseManifestPlugin(): Plugin {
  return {
    name: 'rebase-web-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'rebase-manifest.json',
        source: JSON.stringify({
          productVersion: packageJson.version,
          rendererBuildId
        })
      })
    }
  }
}

export default defineConfig({
  root: path.resolve('src/web'),
  base: '/',
  plugins: [rebaseManifestPlugin(), tailwindcss(), react()],
  publicDir: path.resolve('src/renderer/public'),
  define: {
    __REBASE_RENDERER_BUILD_ID__: JSON.stringify(rendererBuildId)
  },
  worker: {
    format: 'es'
  },
  resolve: {
    alias: {
      '@common': path.resolve('src/common')
    }
  },
  build: {
    outDir: path.resolve('out/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve('src/web/index.html')
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
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
