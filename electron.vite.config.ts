import { execSync } from 'node:child_process'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { injectContentSecurityPolicyMeta } from './src/main/app/csp'

const sharedAlias = {
  '@common': path.resolve('src/common'),
  '@shared': path.resolve('src/shared')
}

function resolveCommitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function packagedCspPlugin(): Plugin {
  return {
    name: 'rebase-packaged-csp',
    apply: 'build',
    transformIndexHtml: injectContentSecurityPolicyMeta
  }
}

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAlias
    },
    define: {
      __REBASE_COMMIT_SHA__: JSON.stringify(resolveCommitSha())
    },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve('src/electron/main.ts'),
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
        input: {
          index: path.resolve('src/electron/preload.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: path.resolve('src/web'),
    plugins: [packagedCspPlugin(), tailwindcss(), react()],
    publicDir: path.resolve('src/renderer/public'),
    worker: {
      format: 'es'
    },
    server:
      mode === 'playwright-mcp'
        ? {
            host: '127.0.0.1',
            port: 5173,
            strictPort: true
          }
        : undefined,
    resolve: {
      alias: {
        '@': path.resolve('src/renderer'),
        ...sharedAlias
      }
    },
    build: {
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
  }
}))
