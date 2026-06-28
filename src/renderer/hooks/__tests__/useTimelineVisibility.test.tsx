import { act, render } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import { useTimelineVisibility } from '@/hooks/useTimelineVisibility'
import { type CommitHistory, CommitHistoryProvider } from '@/stores/commit-history'
import { type Refs, RefsProvider } from '@/stores/refs'
import { type RepoSession, RepoSessionProvider } from '@/stores/repo-session'
import type { GitBranches, GitLog, GitLogEntry } from '@/types'

interface TimelineFixture {
  repoPath: string | null
  log: GitLog | null
  branches: GitBranches | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  currentBranch: string
}

const asyncNoop = async () => {}

function fixtureProviders(fixture: TimelineFixture, children: ReactNode): ReactNode {
  const session: RepoSession = {
    repoPath: fixture.repoPath,
    opening: false,
    openGeneration: 0,
    error: null,
    openRepo: async () => null,
    closeRepo: asyncNoop
  }
  const refs: Refs = {
    branches: fixture.branches,
    currentBranch: fixture.currentBranch,
    branchesLoading: false,
    lastFetchedAt: null,
    remotes: fixture.remotes,
    defaultBranch: fixture.defaultBranch,
    fetchNow: asyncNoop
  }
  const history: CommitHistory = {
    log: fixture.log,
    logLoading: false,
    logLoadingMore: false,
    logHasMore: false,
    loadMoreHistory: asyncNoop
  }
  return (
    <RepoSessionProvider value={session}>
      <RefsProvider value={refs}>
        <CommitHistoryProvider value={history}>{children}</CommitHistoryProvider>
      </RefsProvider>
    </RepoSessionProvider>
  )
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
  expandedHashes: string[]
  isMainVisible: boolean
  isFeatureVisible: boolean
  toggle: (refKind: 'local' | 'remote' | 'tag', fullPath: string) => void
  toggleMerge: (hash: string) => void
  setFixture: (next: TimelineFixture) => void
}

let harness: Harness

function TimelineProbe({ setFixture }: { setFixture: (next: TimelineFixture) => void }) {
  const timeline = useTimelineVisibility()
  harness = {
    visibleKeys: [...timeline.visibleRefs].sort(),
    filteredHashes: timeline.filteredCommits.map((commit) => commit.hash),
    expandedHashes: [...timeline.expandedMerges].sort(),
    isMainVisible: timeline.isVisible('local', 'main'),
    isFeatureVisible: timeline.isVisible('local', 'feature'),
    toggle: timeline.toggle,
    toggleMerge: timeline.toggleMergeExpansion,
    setFixture
  }
  return null
}

function TimelineHarness({ initial }: { initial: TimelineFixture }) {
  const [fixture, setFixture] = useState(initial)
  return fixtureProviders(fixture, <TimelineProbe setFixture={setFixture} />)
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

const mergeLog = logOf([
  entry('m4', ['m3', 'f2'], 'HEAD -> main'),
  entry('m3', ['m2']),
  entry('f2', ['f1']),
  entry('f1', ['m2']),
  entry('m2', ['m1']),
  entry('m1', [])
])

const mergeFixture: TimelineFixture = {
  repoPath: '/repo',
  log: mergeLog,
  branches: branchesOf({ current: 'main', all: ['main'] }),
  remotes: {},
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

  it('collapses a merge side branch by default and expands it from the merge', () => {
    renderTimeline(mergeFixture)
    expect(harness.filteredHashes).toEqual(['m4', 'm3', 'm2', 'm1'])
    expect(harness.expandedHashes).toEqual([])

    act(() => {
      harness.toggleMerge('m4')
    })
    expect(harness.expandedHashes).toEqual(['m4'])
    expect(harness.filteredHashes).toEqual(['m4', 'm3', 'f2', 'f1', 'm2', 'm1'])

    act(() => {
      harness.toggleMerge('m4')
    })
    expect(harness.filteredHashes).toEqual(['m4', 'm3', 'm2', 'm1'])
  })

  it('keeps expansion across a ref toggle on the same repo', () => {
    renderTimeline(mergeFixture)
    act(() => {
      harness.toggleMerge('m4')
    })
    act(() => {
      harness.toggle('local', 'feature')
    })
    expect(harness.expandedHashes).toEqual(['m4'])
  })

  it('resets expansion when the repo changes', () => {
    renderTimeline(mergeFixture)
    act(() => {
      harness.toggleMerge('m4')
    })
    expect(harness.expandedHashes).toEqual(['m4'])

    act(() => {
      harness.setFixture({
        repoPath: '/other',
        log: logOf([entry('d2', ['d1'], 'HEAD -> develop'), entry('d1', [])]),
        branches: branchesOf({ current: 'develop', all: ['develop'] }),
        remotes: {},
        defaultBranch: 'develop',
        currentBranch: 'develop'
      })
    })
    expect(harness.expandedHashes).toEqual([])
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
