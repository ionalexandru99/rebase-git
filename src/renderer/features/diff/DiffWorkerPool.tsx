import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import type { ReactNode } from 'react'

export function diffWorkerPoolSize(hardwareConcurrency: number): number {
  return Math.min(6, Math.max(2, Math.floor(hardwareConcurrency / 2)))
}

function createDiffWorker(): Worker {
  return new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' })
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
        theme: 'pierre-dark'
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  )
}
