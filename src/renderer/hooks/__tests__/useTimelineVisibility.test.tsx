import { GRAPH_LAYOUT_DEBOUNCE_MS, GRAPH_LAYOUT_MAX_DEBOUNCE_MS } from '@shared/graph-config'
import { GIT_LOG_REF_SEPARATOR } from '@shared/schemas/git'
import { act, render } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import { coalesceDelayFor, useTimelineVisibility } from '@/hooks/useTimelineVisibility'
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
  logLoading?: boolean
}

const asyncNoop = async () => {}

function fixtureProviders(fixture: TimelineFixture, children: ReactNode): ReactNode {
  const session: RepoSession = {
    repoPath: fixture.repoPath,
    opening: false,
    openGeneration: 0,
    error: null,
    openRepo: async () => null,
    closeRepo: asyncNoop,
    disownRepo: asyncNoop
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
    logLoading: fixture.logLoading ?? false,
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
  return { all: commits, loadedCount: commits.length }
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
  displayedHashes: string[]
  expandedHashes: string[]
  isMainVisible: boolean
  isFeatureVisible: boolean
  toggle: (refKind: 'local' | 'remote' | 'tag', fullPath: string) => void
  toggleMerge: (hash: string) => void
  setFilter: (value: string) => void
  setFixture: (next: TimelineFixture) => void
}

let harness: Harness
let disabledFilteredHashes: string[]

function TimelineProbe({ setFixture }: { setFixture: (next: TimelineFixture) => void }) {
  const timeline = useTimelineVisibility()
  harness = {
    visibleKeys: [...timeline.visibleRefs].sort(),
    filteredHashes: timeline.filteredCommits.map((commit) => commit.hash),
    displayedHashes: [...timeline.displayedCommitSet],
    expandedHashes: [...timeline.expandedMerges].sort(),
    isMainVisible: timeline.isVisible('local', 'main'),
    isFeatureVisible: timeline.isVisible('local', 'feature'),
    toggle: timeline.toggle,
    toggleMerge: timeline.toggleMergeExpansion,
    setFilter: timeline.setFilter,
    setFixture
  }
  return null
}

function TimelineHarness({ initial }: { initial: TimelineFixture }) {
  const [fixture, setFixture] = useState(initial)
  return fixtureProviders(fixture, <TimelineProbe setFixture={setFixture} />)
}

function DisabledTimelineProbe() {
  disabledFilteredHashes = useTimelineVisibility(false).filteredCommits.map((commit) => commit.hash)
  return null
}

function renderTimeline(initial: TimelineFixture) {
  render(<TimelineHarness initial={initial} />)
}

const linearLog = logOf([
  entry('f2', ['f1'], `origin/feature${GIT_LOG_REF_SEPARATOR}feature`),
  entry('f1', ['m2']),
  entry('m2', ['m1'], `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main`),
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

const searchMergeLog = logOf([
  entry('m4', ['m3', 'f2'], 'HEAD -> main', 'merge feature branch'),
  entry('m3', ['m2'], '', 'mainline three'),
  entry('f2', ['f1'], '', 'side branch two'),
  entry('f1', ['m2'], '', 'fix login redirect'),
  entry('m2', ['m1'], '', 'mainline two'),
  entry('m1', [], '', 'mainline one')
])

const searchMergeFixture: TimelineFixture = {
  repoPath: '/repo',
  log: searchMergeLog,
  branches: branchesOf({ current: 'main', all: ['main'] }),
  remotes: {},
  defaultBranch: 'main',
  currentBranch: 'main'
}

describe('useTimelineVisibility', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips commit derivation while the timeline is hidden', () => {
    render(fixtureProviders(baseFixture, <DisabledTimelineProbe />))

    expect(disabledFilteredHashes).toEqual([])
  })

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

  it('includes commits reachable from detached HEAD', () => {
    renderTimeline({
      ...baseFixture,
      log: logOf([entry('detached', ['m2'], 'HEAD'), entry('m2', ['m1']), entry('m1', [])]),
      branches: branchesOf({ current: '' }),
      remotes: {},
      defaultBranch: undefined,
      currentBranch: ''
    })

    expect(harness.filteredHashes).toEqual(['detached', 'm2', 'm1'])
    expect(harness.visibleKeys).toEqual([])
  })

  it('includes tag-only commits without selecting the tag as a timeline branch', () => {
    renderTimeline({
      ...baseFixture,
      log: logOf([
        entry('tagged', ['tag-base'], 'tag: archive'),
        entry('tag-base', []),
        entry('m2', ['m1'], `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main`),
        entry('m1', [])
      ]),
      branches: branchesOf({
        current: 'main',
        all: ['main'],
        remotes: ['origin/main'],
        tags: ['archive']
      })
    })

    expect(harness.filteredHashes).toEqual(['tagged', 'tag-base', 'm2', 'm1'])
    expect(harness.visibleKeys).not.toContain(refFilterKey('tag', 'archive'))
  })

  it('drops selected refs that no longer exist', () => {
    renderTimeline(baseFixture)
    act(() => {
      harness.toggle('local', 'feature')
    })

    act(() => {
      harness.setFixture({
        ...baseFixture,
        log: logOf([
          entry('m2', ['m1'], `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main`),
          entry('m1', [])
        ]),
        branches: branchesOf({ current: 'main', all: ['main'], remotes: ['origin/main'] })
      })
    })

    expect(harness.visibleKeys).toEqual(
      [refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')].sort()
    )
    expect(harness.isFeatureVisible).toBe(false)
    expect(harness.filteredHashes).toEqual(['m2', 'm1'])
  })

  it('coalesces commit derivation while history is streaming', async () => {
    vi.useFakeTimers()
    renderTimeline({ ...baseFixture, logLoading: true })
    const nextLog = logOf([
      entry('new-main', ['m2'], `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main`),
      entry('m2', ['m1']),
      entry('m1', [])
    ])

    act(() => {
      harness.setFixture({ ...baseFixture, log: nextLog, logLoading: true })
    })
    expect(harness.filteredHashes).toEqual(['m2', 'm1'])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(harness.filteredHashes).toEqual(['new-main', 'm2', 'm1'])
  })

  it('widens the coalescing window as the loaded log grows', () => {
    expect(coalesceDelayFor(0)).toBe(GRAPH_LAYOUT_DEBOUNCE_MS)
    expect(coalesceDelayFor(2_000)).toBe(GRAPH_LAYOUT_DEBOUNCE_MS)
    expect(coalesceDelayFor(20_000)).toBeGreaterThan(GRAPH_LAYOUT_DEBOUNCE_MS)
    expect(coalesceDelayFor(500_000)).toBe(GRAPH_LAYOUT_MAX_DEBOUNCE_MS)
  })

  it('collapses a merge side branch by default and expands it from the merge', () => {
    renderTimeline(mergeFixture)
    expect(harness.filteredHashes).toEqual(['m4', 'm3', 'm2', 'm1'])
    expect(harness.displayedHashes).toEqual(['m4', 'm3', 'm2', 'm1'])
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

  it('keeps a tagged merge side branch collapsed when it is reachable from a branch', () => {
    renderTimeline({
      ...mergeFixture,
      log: logOf([
        entry('m4', ['m3', 'f2'], 'HEAD -> main'),
        entry('m3', ['m2']),
        entry('f2', ['f1'], 'tag: merged-feature'),
        entry('f1', ['m2']),
        entry('m2', ['m1']),
        entry('m1', [])
      ]),
      branches: branchesOf({ current: 'main', all: ['main'], tags: ['merged-feature'] })
    })

    expect(harness.filteredHashes).toEqual(['m4', 'm3', 'm2', 'm1'])
  })

  it('auto-reveals a merge whose collapsed side branch holds the only search match', () => {
    renderTimeline(searchMergeFixture)
    expect(harness.filteredHashes).toEqual(['m4', 'm3', 'm2', 'm1'])

    act(() => {
      harness.setFilter('login')
    })
    expect(harness.filteredHashes).toContain('f1')
    expect(harness.expandedHashes).toContain('m4')
  })

  it('restores exactly the manual expansion when the search clears', () => {
    renderTimeline(searchMergeFixture)
    act(() => {
      harness.setFilter('login')
    })
    act(() => {
      harness.setFilter('')
    })
    expect(harness.filteredHashes).toEqual(['m4', 'm3', 'm2', 'm1'])
    expect(harness.expandedHashes).toEqual([])
  })

  it('leaves a manually expanded merge expanded after a search clears', () => {
    renderTimeline(searchMergeFixture)
    act(() => {
      harness.toggleMerge('m4')
    })
    act(() => {
      harness.setFilter('login')
    })
    act(() => {
      harness.setFilter('')
    })
    expect(harness.expandedHashes).toEqual(['m4'])
    expect(harness.filteredHashes).toContain('f1')
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
