import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiffWorkerPoolProvider, diffWorkerPoolSize } from '../DiffWorkerPool'

const captured = vi.hoisted(() => ({
  providerProps: [] as Array<Record<string, unknown>>
}))

vi.mock('@pierre/diffs/react', () => ({
  WorkerPoolContextProvider: (props: Record<string, unknown>) => {
    captured.providerProps.push(props)
    return props.children
  },
  useWorkerPool: () => undefined
}))

describe('diffWorkerPoolSize', () => {
  it('clamps half the hardware concurrency between 2 and 6', () => {
    expect(diffWorkerPoolSize(1)).toBe(2)
    expect(diffWorkerPoolSize(4)).toBe(2)
    expect(diffWorkerPoolSize(8)).toBe(4)
    expect(diffWorkerPoolSize(16)).toBe(6)
    expect(diffWorkerPoolSize(32)).toBe(6)
  })
})

describe('DiffWorkerPoolProvider', () => {
  beforeEach(() => {
    captured.providerProps.length = 0
  })

  it('renders children without a pool when Worker is unavailable', () => {
    expect(typeof Worker).toBe('undefined')
    render(
      <DiffWorkerPoolProvider>
        <div data-testid="pool-child" />
      </DiffWorkerPoolProvider>
    )
    expect(screen.getByTestId('pool-child')).toBeInTheDocument()
    expect(captured.providerProps).toEqual([])
  })

  it('mounts the library provider with pool and highlighter options when Worker exists', () => {
    const constructed: Array<{ url: URL; options: WorkerOptions | undefined }> = []
    class FakeWorker {
      constructor(url: URL, options?: WorkerOptions) {
        constructed.push({ url, options })
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    try {
      render(
        <DiffWorkerPoolProvider>
          <div data-testid="pool-child" />
        </DiffWorkerPoolProvider>
      )
      expect(screen.getByTestId('pool-child')).toBeInTheDocument()
      const props = captured.providerProps.at(0)
      expect(props?.poolOptions).toMatchObject({
        poolSize: diffWorkerPoolSize(navigator.hardwareConcurrency),
        totalASTLRUCacheSize: 240
      })
      expect(props?.highlighterOptions).toMatchObject({
        preferredHighlighter: 'shiki-js',
        theme: 'pierre-dark'
      })
      const poolOptions = props?.poolOptions as { workerFactory: () => Worker }
      poolOptions.workerFactory()
      expect(constructed).toHaveLength(1)
      expect(constructed[0].options).toEqual({ type: 'module' })
      expect(String(constructed[0].url)).toContain('worker')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
