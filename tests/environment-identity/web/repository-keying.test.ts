import { EnvironmentIdSchema } from '@common/features/repository-identity'
import { parseOrThrow } from '@shared/codec'
import { PersistedTabsSchema } from '@shared/schemas/ipc'
import { act, renderHook } from '@testing-library/react'
import {
  repoQueryKeys,
  repositoryIdentityKey,
  restorePersistedRepository
} from '../../../src/renderer/features/repository-identity'
import { identityQueryKey } from '../../../src/renderer/stores/identity'
import { useTabs } from '../../../src/renderer/hooks/useTabs'
import { createRepoSessionOwnership } from '../../../src/renderer/stores/repo-session-ownership'
import {
  emptyRepoSessionLifecycle,
  useRepoSessionController
} from '../../../src/renderer/stores/repo-session'

describe('renderer repository keying', () => {
  it('never collides equal native paths from different Environments', () => {
    const environmentA = EnvironmentIdSchema.make('environment-a')
    const environmentB = EnvironmentIdSchema.make('environment-b')
    const repositoryA = { environmentId: environmentA, path: '/same/repository' }
    const repositoryB = { environmentId: environmentB, path: '/same/repository' }

    expect(repositoryIdentityKey(repositoryA)).not.toBe(repositoryIdentityKey(repositoryB))
    expect(repoQueryKeys(repositoryA).root).toEqual([
      'repo',
      'environment-a',
      '/same/repository'
    ])
    expect(repoQueryKeys(repositoryB).root).toEqual([
      'repo',
      'environment-b',
      '/same/repository'
    ])
    expect(repoQueryKeys(repositoryA).status).not.toEqual(repoQueryKeys(repositoryB).status)
    expect(repoQueryKeys(repositoryA).localBranches).not.toEqual(
      repoQueryKeys(repositoryB).localBranches
    )
    expect(repoQueryKeys(repositoryA).remoteRefs).not.toEqual(
      repoQueryKeys(repositoryB).remoteRefs
    )
    expect(repoQueryKeys(repositoryA).log).not.toEqual(repoQueryKeys(repositoryB).log)
    expect(repoQueryKeys(repositoryA).stash).not.toEqual(repoQueryKeys(repositoryB).stash)
    expect(repoQueryKeys(repositoryA).diffRoot).not.toEqual(repoQueryKeys(repositoryB).diffRoot)
    expect(repoQueryKeys(repositoryA).headCommit).not.toEqual(
      repoQueryKeys(repositoryB).headCommit
    )
    expect(identityQueryKey(repositoryA)).not.toEqual(identityQueryKey(repositoryB))
  })

  it('adapts legacy Electron paths into the implicit local Environment namespace', () => {
    expect(repoQueryKeys('/legacy/repository').root).toEqual([
      'repo',
      'local',
      '/legacy/repository'
    ])
    expect(identityQueryKey('/legacy/repository')).toEqual([
      'identity',
      'local',
      '/legacy/repository'
    ])
  })

  it('allows equal native paths in different Environments and deduplicates each RepoRef', () => {
    const { result } = renderHook(() => useTabs({ tabs: [null], activeIndex: 0 }))
    const environmentA = EnvironmentIdSchema.make('environment-a')
    const environmentB = EnvironmentIdSchema.make('environment-b')
    const repositoryA = { environmentId: environmentA, path: '/same/repository' }
    const repositoryB = { environmentId: environmentB, path: '/same/repository' }

    act(() => {
      result.current.openRepoInTab(result.current.activeTabId, repositoryA)
      result.current.confirmRepoOpen(result.current.activeTabId, repositoryA)
      result.current.newTab()
    })
    const secondTabId = result.current.activeTabId
    act(() => {
      expect(result.current.openRepoInTab(secondTabId, repositoryB)).toBe(false)
      result.current.confirmRepoOpen(secondTabId, repositoryB)
    })

    expect(result.current.tabs).toHaveLength(2)
    expect(
      result.current.tabs.map((tab) => (tab.kind === 'repo' ? tab.repoRef.environmentId : null))
    ).toEqual([environmentA, environmentB])
    expect(result.current.persistedSnapshot.tabs).toEqual([repositoryA, repositoryB])

    act(() => {
      result.current.newTab()
    })
    const duplicateSource = result.current.activeTabId
    act(() => {
      expect(result.current.openRepoInTab(duplicateSource, repositoryA)).toBe(true)
    })
    expect(result.current.tabs).toHaveLength(2)
  })

  it('round-trips same-path repositories from different Environments through persistence', () => {
    const environmentA = EnvironmentIdSchema.make('environment-a')
    const environmentB = EnvironmentIdSchema.make('environment-b')
    const persisted = parseOrThrow(PersistedTabsSchema, {
      tabs: [
        { environmentId: environmentA, path: '/same/repository' },
        { environmentId: environmentB, path: '/same/repository' },
        '/legacy/repository'
      ],
      activeIndex: 1
    })
    const { result } = renderHook(() =>
      useTabs({
        tabs: persisted.tabs.map(restorePersistedRepository),
        activeIndex: persisted.activeIndex
      })
    )

    expect(result.current.persistedSnapshot.tabs).toEqual([
      { environmentId: environmentA, path: '/same/repository' },
      { environmentId: environmentB, path: '/same/repository' },
      { environmentId: EnvironmentIdSchema.make('local'), path: '/legacy/repository' }
    ])
    expect(result.current.activeTabId).toBe(result.current.tabs[1].id)
  })

  it('compares RepoRef fields exactly while retaining legacy path alias reconciliation', () => {
    const environmentId = EnvironmentIdSchema.make('environment-a')
    const canonical = { environmentId, path: '/same/repository' }
    const distinctPath = { environmentId, path: '/same/repository/' }
    const { result } = renderHook(() => useTabs({ tabs: [canonical, null], activeIndex: 1 }))

    act(() => {
      expect(result.current.openRepoInTab(result.current.activeTabId, distinctPath)).toBe(false)
      result.current.confirmRepoOpen(result.current.activeTabId, distinctPath)
    })

    expect(result.current.persistedSnapshot.tabs).toEqual([canonical, distinctPath])
  })

  it('keeps a canonical Agent response in the requested Environment', () => {
    const environmentId = EnvironmentIdSchema.make('environment-a')
    const requested = { environmentId, path: '/alias/repository' }
    const { result } = renderHook(() => useTabs({ tabs: [null], activeIndex: 0 }))

    act(() => {
      result.current.openRepoInTab(result.current.activeTabId, requested)
      result.current.confirmRepoOpen(result.current.activeTabId, '/canonical/repository')
    })

    expect(result.current.persistedSnapshot.tabs).toEqual([
      { environmentId, path: '/canonical/repository' }
    ])
  })

  it('keeps opens and pending closes isolated across Environments', () => {
    const ownership = createRepoSessionOwnership()
    const environmentA = EnvironmentIdSchema.make('environment-a')
    const environmentB = EnvironmentIdSchema.make('environment-b')
    const repositoryA = { environmentId: environmentA, path: '/same/repository' }
    const repositoryB = { environmentId: environmentB, path: '/same/repository' }
    const pendingClose = setTimeout(() => {}, 10)

    const identityA = ownership.beginOpen(repositoryA)
    ownership.trackPendingClose(repositoryA, pendingClose)

    expect(ownership.hasActiveOpen(repositoryA)).toBe(true)
    expect(ownership.hasActiveOpen(repositoryB)).toBe(false)
    expect(ownership.matchesPendingClose(repositoryA, pendingClose)).toBe(true)
    expect(ownership.matchesPendingClose(repositoryB, pendingClose)).toBe(false)

    ownership.endOpen(identityA)
    ownership.releasePendingClose(repositoryA)
    clearTimeout(pendingClose)
  })

  it('moves open and pending-close ownership to an Agent-canonicalized identity', () => {
    const ownership = createRepoSessionOwnership()
    const environmentId = EnvironmentIdSchema.make('environment-a')
    const requested = { environmentId, path: '/alias/repository' }
    const canonical = { environmentId, path: '/canonical/repository' }
    const pendingClose = setTimeout(() => {}, 10)
    const opening = ownership.beginOpen(requested)
    ownership.trackPendingClose(requested, pendingClose)

    ownership.rememberCanonicalPath(requested, canonical)

    expect(ownership.hasActiveOpen(requested)).toBe(true)
    expect(ownership.hasActiveOpen(canonical)).toBe(true)
    expect(ownership.matchesPendingClose(requested, pendingClose)).toBe(true)
    expect(ownership.matchesPendingClose(canonical, pendingClose)).toBe(true)

    ownership.endOpen(opening)
    ownership.releasePendingClose(canonical)
    expect(ownership.hasActiveOpen(canonical)).toBe(false)
    clearTimeout(pendingClose)
  })

  it('releases every concurrent open after Agent canonicalization', () => {
    const ownership = createRepoSessionOwnership()
    const environmentId = EnvironmentIdSchema.make('environment-a')
    const requested = { environmentId, path: '/alias/repository' }
    const canonical = { environmentId, path: '/canonical/repository' }
    const firstOpening = ownership.beginOpen(requested)
    const secondOpening = ownership.beginOpen(requested)

    ownership.rememberCanonicalPath(requested, canonical)
    ownership.endOpen(firstOpening)
    expect(ownership.hasActiveOpen(canonical)).toBe(true)

    ownership.endOpen(secondOpening)
    expect(ownership.hasActiveOpen(canonical)).toBe(false)
  })

  it('replaces a same-path session when its Environment changes', async () => {
    const environmentA = EnvironmentIdSchema.make('environment-a')
    const environmentB = EnvironmentIdSchema.make('environment-b')
    const repositoryA = { environmentId: environmentA, path: '/same/repository' }
    const repositoryB = { environmentId: environmentB, path: '/same/repository' }
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/same/repository', remotes: {}, defaultBranch: 'main' }
    })
    const lifecycle = { current: emptyRepoSessionLifecycle }
    const { result, unmount } = renderHook(() => useRepoSessionController(lifecycle))

    await act(() => result.current.openRepo(repositoryA))
    await act(() => result.current.openRepo(repositoryB))

    expect(result.current.repoRef).toEqual(repositoryB)
    expect(window.electronAPI.closeRepo).toHaveBeenCalledWith('/same/repository', 1)
    unmount()
  })
})
