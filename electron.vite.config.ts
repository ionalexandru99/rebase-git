import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { injectContentSecurityPolicyMeta } from './src/main/csp'

const sharedAlias = {
  '@shared': path.resolve('src/shared')
}

function packagedCspPlugin(): Plugin {
  return {
    name: 'rebase-packaged-csp',
    apply: 'build',
    transformIndexHtml: injectContentSecurityPolicyMeta
  }
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
    },
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [packagedCspPlugin(), tailwindcss(), react()],
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
  }
})
