import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import { useTimelineVisibility } from '@/hooks/useTimelineVisibility'
import type { GitStore } from '@/stores/git'
import type { GitBranches, GitLog, GitLogEntry } from '@/types'

interface TimelineFixture {
  repoPath: string | null
  log: GitLog | null
  branches: GitBranches | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  currentBranch: string
}

function fixtureToGit(fixture: TimelineFixture): GitStore {
  return { state: fixture } as unknown as GitStore
}

function entry(hash: string, parents: string[], refs = '', message = hash): GitLogEntry {
  return {
    hash,
    message,
    author_name: 'Ada',
    date: '2026-01-01T00:00:00Z',
    parents,
    refs
  }
}

function logOf(commits: GitLogEntry[]): GitLog {
  return { all: commits, total: commits.length }
}

function branchesOf(partial: Partial<GitBranches>): GitBranches {
  return {
    current: '',
    all: [],
    remotes: [],
    tags: [],
    ...partial
  }
}

interface Harness {
  visibleKeys: string[]
  filteredHashes: string[]
  isMainVisible: boolean
  isFeatureVisible: boolean
  toggle: (refKind: 'local' | 'remote' | 'tag', fullPath: string) => void
  setFixture: (next: TimelineFixture) => void
}

let harness: Harness

function TimelineHarness({ initial }: { initial: TimelineFixture }) {
  const [fixture, setFixture] = useState(initial)
  const timeline = useTimelineVisibility(fixtureToGit(fixture))
  harness = {
    visibleKeys: [...timeline.visibleRefs].sort(),
    filteredHashes: timeline.filteredCommits.map((commit) => commit.hash),
    isMainVisible: timeline.isVisible('local', 'main'),
    isFeatureVisible: timeline.isVisible('local', 'feature'),
    toggle: timeline.toggle,
    setFixture
  }
  return null
}

function renderTimeline(initial: TimelineFixture) {
  render(<TimelineHarness initial={initial} />)
}

const linearLog = logOf([
  entry('f2', ['f1'], 'origin/feature, feature'),
  entry('f1', ['m2']),
  entry('m2', ['m1'], 'HEAD -> main, origin/main'),
  entry('m1', [])
])

const baseFixture: TimelineFixture = {
  repoPath: '/repo',
  log: linearLog,
  branches: branchesOf({
    current: 'main',
    all: ['main', 'feature'],
    remotes: ['origin/main', 'origin/feature']
  }),
  remotes: { origin: 'git@example.com:repo.git' },
  defaultBranch: 'main',
  currentBranch: 'main'
}

describe('useTimelineVisibility', () => {
  it('defaults to the default branch and its tracking remote', () => {
    renderTimeline(baseFixture)
    expect(harness.visibleKeys).toEqual(
      [refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')].sort()
    )
    expect(harness.isMainVisible).toBe(true)
    expect(harness.isFeatureVisible).toBe(false)
  })

  it('toggling a local ref on also shows its tracking remote', () => {
    renderTimeline(baseFixture)
    act(() => {
      harness.toggle('local', 'feature')
    })
    expect(harness.visibleKeys).toContain(refFilterKey('local', 'feature'))
    expect(harness.visibleKeys).toContain(refFilterKey('remote', 'origin/feature'))
  })

  it('hiding a ref drops exactly its reachable commits from the filtered output', () => {
    renderTimeline(baseFixture)
    act(() => {
      harness.toggle('local', 'feature')
    })
    expect(harness.filteredHashes.sort()).toEqual(['f1', 'f2', 'm1', 'm2'])
    act(() => {
      harness.toggle('local', 'feature')
    })
    expect(harness.filteredHashes.sort()).toEqual(['m1', 'm2'])
  })

  it('switching repos resets to the new repo defaults', () => {
    renderTimeline(baseFixture)
    act(() => {
      harness.toggle('local', 'feature')
    })
    expect(harness.isFeatureVisible).toBe(true)

    const otherLog = logOf([entry('d2', ['d1'], 'HEAD -> develop'), entry('d1', [])])
    act(() => {
      harness.setFixture({
        repoPath: '/other',
        log: otherLog,
        branches: branchesOf({ current: 'develop', all: ['develop'] }),
        remotes: {},
        defaultBranch: 'develop',
        currentBranch: 'develop'
      })
    })

    expect(harness.visibleKeys).toEqual([refFilterKey('local', 'develop')])
    expect(harness.filteredHashes.sort()).toEqual(['d1', 'd2'])
  })
})
