import { useWorkerPool, WorkerPoolContextProvider } from '@pierre/diffs/react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useThemeNonce } from '@/hooks/useThemeNonce'

const DIFF_THEME_NAMES = {
  light: 'pierre-light',
  dark: 'pierre-dark'
} as const

type DiffThemeType = keyof typeof DIFF_THEME_NAMES

export function diffWorkerPoolSize(hardwareConcurrency: number): number {
  return Math.min(6, Math.max(2, Math.floor(hardwareConcurrency / 2)))
}

function currentThemeType(): DiffThemeType {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function createDiffWorker(): Worker {
  return new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' })
}

function DiffWorkerPoolThemeSync(): null {
  const poolManager = useWorkerPool()
  useThemeNonce()
  const themeType = currentThemeType()
  const appliedThemeType = useRef(themeType)

  useEffect(() => {
    if (poolManager == null || appliedThemeType.current === themeType) {
      return
    }
    appliedThemeType.current = themeType
    void poolManager.setRenderOptions({ theme: DIFF_THEME_NAMES[themeType] })
  }, [poolManager, themeType])

  return null
}

export function DiffWorkerPoolProvider({ children }: { children: ReactNode }): ReactNode {
  if (typeof Worker === 'undefined') {
    return children
  }

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: createDiffWorker,
        poolSize: diffWorkerPoolSize(navigator.hardwareConcurrency),
        totalASTLRUCacheSize: 240
      }}
      highlighterOptions={{
        preferredHighlighter: 'shiki-js',
        theme: DIFF_THEME_NAMES[currentThemeType()]
      }}
    >
      <DiffWorkerPoolThemeSync />
      {children}
    </WorkerPoolContextProvider>
  )
}
