import { createRoot, createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDisplayRows, useGraphLayoutWorker } from '@/hooks/useGraphLayoutWorker'
import type { GitLogEntry } from '@/types'

function entry(hash: string, parents: string[] = []): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: new Date().toISOString(),
    parents,
    refs: ''
  }
}

describe('useGraphLayoutWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lays out commits synchronously', async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const graphLayout = useGraphLayoutWorker({
          commits: () => [entry('a', ['b']), entry('b')],
          loading: () => false,
          enabled: () => true,
          debounceMs: 0
        })

        const wait = () => {
          const layout = graphLayout.layout()
          if (layout && layout.rows.length === 2) {
            expect(graphLayout.laidOutThroughIndex()).toBe(2)
            expect(layout.maxLanes).toBeGreaterThan(0)
            dispose()
            resolve()
            return
          }
          setTimeout(wait, 10)
        }
        wait()
      })
    })
  })

  it('lays out the first batch immediately while history is still loading', async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const graphLayout = useGraphLayoutWorker({
          commits: () => [entry('a')],
          loading: () => true,
          enabled: () => true,
          debounceMs: 250
        })

        const wait = () => {
          const layout = graphLayout.layout()
          if (layout && layout.rows.length === 1) {
            dispose()
            resolve()
            return
          }
          setTimeout(wait, 10)
        }
        wait()
      })
    })
  })

  it('recomputes layout when the filtered commit list shrinks', async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const [commits, setCommits] = createSignal([
          entry('a', ['b']),
          entry('b', ['c']),
          entry('c')
        ])
        const graphLayout = useGraphLayoutWorker({
          commits,
          loading: () => false,
          enabled: () => true,
          debounceMs: 0
        })

        const waitForLayout = (expectedLength: number, onMatch: () => void) => {
          const layout = graphLayout.layout()
          if (layout && layout.rows.length === expectedLength) {
            onMatch()
            return
          }
          setTimeout(() => waitForLayout(expectedLength, onMatch), 10)
        }

        waitForLayout(3, () => {
          setCommits([entry('a', ['b']), entry('b')])
          waitForLayout(2, () => {
            expect(graphLayout.layout()?.commits.map((commit) => commit.hash)).toEqual(['a', 'b'])
            dispose()
            resolve()
          })
        })
      })
    })
  })

  it('buildDisplayRows fills beyond laid-out indices with empty graph rows', () => {
    const commits = [entry('a'), entry('b'), entry('c')]
    const layout = {
      rows: [
        {
          commit: commits[0],
          commitLane: 0,
          incoming: [],
          outgoing: ['b']
        }
      ],
      maxLanes: 1,
      lanesAfter: ['b'],
      commits: [commits[0]],
      laidOutThroughIndex: 1
    }

    const rows = buildDisplayRows(commits, layout, 1)
    expect(rows).toHaveLength(3)
    expect(rows[0].commit.hash).toBe('a')
    expect(rows[1].incoming).toEqual([])
    expect(rows[2].incoming).toEqual([])
  })
})
