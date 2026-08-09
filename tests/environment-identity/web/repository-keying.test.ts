import { EnvironmentIdSchema } from '@common/features/repository-identity'
import { act, renderHook } from '@testing-library/react'
import {
  repoQueryKeys,
  repositoryIdentityKey
} from '../../../src/renderer/features/repository-identity'
import { identityQueryKey } from '../../../src/renderer/stores/identity'
import { useTabs } from '../../../src/renderer/hooks/useTabs'
import { createRepoSessionOwnership } from '../../../src/renderer/stores/repo-session-ownership'

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
})
