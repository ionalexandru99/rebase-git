import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'

const sharedAlias = {
  '@shared': path.resolve('src/shared')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAlias
    },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve('src/main/index.ts'),
          sidecar: path.resolve('src/sidecar/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAlias
    }
  },
  renderer: {
    plugins: [tailwindcss(), solid()],
    resolve: {
      alias: {
        '@': path.resolve('src/renderer'),
        ...sharedAlias
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve('src/renderer/index.html')
        },
        onwarn(warning, defaultHandler) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
          if (warning.code === 'SOURCEMAP_ERROR' && warning.message?.includes('use client')) return
          defaultHandler(warning)
        }
      }
    }
  }
})
