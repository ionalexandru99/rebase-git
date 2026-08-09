import { builtinModules } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'
import packageJson from './package.json'

const runtimeEntries = {
  agent: path.resolve('src/agent/index.ts'),
  server: path.resolve('src/server/index.ts')
} as const

export default defineConfig(({ mode }) => {
  if (!(mode in runtimeEntries)) {
    throw new Error(`Unknown runtime build mode: ${mode}`)
  }

  const runtime = mode as keyof typeof runtimeEntries
  const externalPackages = [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies)
  ]

  return {
    resolve: {
      alias: {
        '@common': path.resolve('src/common'),
        '@shared': path.resolve('src/shared')
      }
    },
    build: {
      target: 'node24',
      outDir: `out/${runtime}`,
      emptyOutDir: true,
      sourcemap: true,
      lib: {
        entry: runtimeEntries[runtime],
        formats: ['es'],
        fileName: 'index'
      },
      rollupOptions: {
        external: [
          ...builtinModules,
          ...builtinModules.map((moduleName) => `node:${moduleName}`),
          ...externalPackages
        ]
      }
    }
  }
})
