import type { RepoRef } from '@common/features/repository-identity'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type RepositoryIdentity,
  repositoryIdentityKey,
  toRepoRef
} from '@/features/repository-identity'

export interface TabDescriptor {
  id: string
  title: string
  hasRepo: boolean
  repoPath: string | null
  loaded?: boolean
}

interface NewTabRecord {
  id: string
  kind: 'new'
}

interface RepoTabRecord {
  id: string
  kind: 'repo'
  repoPath: string
  repoRef: RepoRef
  openRevision?: number
}

interface OpeningRepoTabRecord {
  id: string
  kind: 'opening-repo'
  repoPath: string
  repoRef: RepoRef
}

interface FailedRepoTabRecord {
  id: string
  kind: 'failed-repo'
  repoPath: string
  repoRef: RepoRef
}

export type TabRecord = NewTabRecord | RepoTabRecord | OpeningRepoTabRecord | FailedRepoTabRecord

export interface InitialTabState {
  tabs: (RepositoryIdentity | null)[]
  activeIndex: number
}

export interface PersistedTabState {
  tabs: (RepoRef | null)[]
  activeIndex: number
}

let tabSeq = 0
const nextTabId = () => `tab-${++tabSeq}-${Date.now()}`

const normalizedRepositoryKey = (repository: RepositoryIdentity): string => {
  const repoRef = toRepoRef(repository)
  const normalizedPath = repoRef.path
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .filter(Boolean)
    .join('/')
  return repositoryIdentityKey({ ...repoRef, path: normalizedPath })
}

const comparisonKey = (repository: RepositoryIdentity): string =>
  typeof repository === 'string'
    ? normalizedRepositoryKey(repository)
    : repositoryIdentityKey(repository)

const repositoriesMatch = (stored: RepoRef, candidate: RepositoryIdentity): boolean =>
  typeof candidate === 'string'
    ? normalizedRepositoryKey(stored) === normalizedRepositoryKey(candidate)
    : repositoryIdentityKey(stored) === repositoryIdentityKey(candidate)

function hydrateFromPersisted(persisted: InitialTabState | undefined): {
  tabs: TabRecord[]
  activeTabId: string
} {
  const sourceRepositories = persisted && persisted.tabs.length > 0 ? persisted.tabs : [null]
  const tabs: TabRecord[] = []
  const hydratedIds: string[] = []
  const repoIdsByIdentity = new Map<string, string>()
  for (const repository of sourceRepositories) {
    if (!repository) {
      const tab = { id: nextTabId(), kind: 'new' } satisfies NewTabRecord
      tabs.push(tab)
      hydratedIds.push(tab.id)
      continue
    }
    const repoRef = toRepoRef(repository)
    const key = comparisonKey(repository)
    const existingId = repoIdsByIdentity.get(key)
    if (existingId) {
      hydratedIds.push(existingId)
      continue
    }
    const tab = {
      id: nextTabId(),
      kind: 'repo',
      repoPath: repoRef.path,
      repoRef
    } satisfies RepoTabRecord
    tabs.push(tab)
    hydratedIds.push(tab.id)
    repoIdsByIdentity.set(key, tab.id)
  }
  const activeIdx =
    persisted && persisted.activeIndex >= 0 && persisted.activeIndex < hydratedIds.length
      ? persisted.activeIndex
      : 0
  return { tabs, activeTabId: hydratedIds[activeIdx] ?? tabs[0].id }
}

export interface TabsStore {
  tabs: TabRecord[]
  activeTabId: string
  setActiveTabId: (id: string) => void
  tabDescriptors: TabDescriptor[]
  newTab: () => void
  closeTab: (id: string) => void
  openRepoInTab: (sourceTabId: string, repository: RepositoryIdentity) => boolean
  confirmRepoOpen: (id: string, repository: RepositoryIdentity) => boolean
  cancelRepoOpen: (id: string, repository: RepositoryIdentity) => void
  persistedSnapshot: PersistedTabState
}

export function useTabs(persisted?: InitialTabState): TabsStore {
  const [initial] = useState(() => hydrateFromPersisted(persisted))
  const [tabs, setTabs] = useState<TabRecord[]>(initial.tabs)
  const [activeTabId, setActiveTabId] = useState<string>(initial.activeTabId)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)

  const replaceTabs = useCallback((next: TabRecord[]) => {
    tabsRef.current = next
    setTabs(next)
  }, [])

  const activateTab = useCallback((id: string) => {
    activeTabIdRef.current = id
    setActiveTabId(id)
  }, [])

  const newTab = useCallback(() => {
    const id = nextTabId()
    replaceTabs([...tabsRef.current, { id, kind: 'new' }])
    activateTab(id)
  }, [activateTab, replaceTabs])

  const closeTab = useCallback(
    (id: string) => {
      const current = tabsRef.current
      if (current.length <= 1) {
        const freshId = nextTabId()
        replaceTabs([{ id: freshId, kind: 'new' }])
        activateTab(freshId)
        return
      }
      const idx = current.findIndex((tab) => tab.id === id)
      const next = current.filter((tab) => tab.id !== id)
      replaceTabs(next)
      if (activeTabIdRef.current === id) {
        activateTab(next[Math.min(idx, next.length - 1)].id)
      }
    },
    [activateTab, replaceTabs]
  )

  const openRepoInTab = useCallback(
    (sourceTabId: string, repository: RepositoryIdentity): boolean => {
      const repoRef = toRepoRef(repository)
      const current = tabsRef.current
      const match = current.find(
        (tab) =>
          (tab.kind === 'repo' || tab.kind === 'opening-repo') &&
          repositoriesMatch(tab.repoRef, repository) &&
          tab.id !== sourceTabId
      )
      if (match) {
        activateTab(match.id)
        replaceTabs(current.filter((tab) => tab.id !== sourceTabId))
        return true
      }

      const next = current.map((tab) =>
        tab.id === sourceTabId
          ? ({
              id: tab.id,
              kind: 'opening-repo',
              repoPath: repoRef.path,
              repoRef
            } satisfies OpeningRepoTabRecord)
          : tab
      )
      replaceTabs(next)
      activateTab(sourceTabId)
      return false
    },
    [activateTab, replaceTabs]
  )

  const confirmRepoOpen = useCallback(
    (id: string, repository: RepositoryIdentity): boolean => {
      const current = tabsRef.current
      const currentOpening = current.find((tab) => tab.id === id)
      const suppliedRepoRef = toRepoRef(repository)
      const repoRef =
        typeof repository === 'string' &&
        currentOpening &&
        (currentOpening.kind === 'opening-repo' || currentOpening.kind === 'failed-repo')
          ? { ...currentOpening.repoRef, path: repository }
          : suppliedRepoRef
      const existing = current.find(
        (tab) =>
          tab.id !== id &&
          (tab.kind === 'repo' || tab.kind === 'opening-repo') &&
          repositoryIdentityKey(tab.repoRef) === repositoryIdentityKey(repoRef)
      )
      if (existing) {
        replaceTabs(
          current
            .filter((tab) => tab.id !== id)
            .map((tab) =>
              tab.id === existing.id && tab.kind === 'repo'
                ? { ...tab, openRevision: (tab.openRevision ?? 0) + 1 }
                : tab
            )
        )
        activateTab(existing.id)
        return false
      }
      const next = current.map((tab) =>
        tab.id === id
          ? ({ ...tab, id, kind: 'repo', repoPath: repoRef.path, repoRef } satisfies RepoTabRecord)
          : tab
      )
      replaceTabs(next)
      return true
    },
    [activateTab, replaceTabs]
  )

  const cancelRepoOpen = useCallback(
    (id: string, repository: RepositoryIdentity) => {
      const current = tabsRef.current
      const next = current.map((tab) =>
        tab.id === id &&
        tab.kind === 'opening-repo' &&
        repositoriesMatch(
          tab.repoRef,
          typeof repository === 'string' ? { ...tab.repoRef, path: repository } : repository
        )
          ? ({
              id,
              kind: 'failed-repo',
              repoPath: tab.repoRef.path,
              repoRef: tab.repoRef
            } satisfies FailedRepoTabRecord)
          : tab
      )
      replaceTabs(next)
    },
    [replaceTabs]
  )

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      const current = tabsRef.current
      if (current.length <= 1) {
        return
      }
      const idx = current.findIndex((tab) => tab.id === activeTabIdRef.current)
      if (idx === -1) {
        return
      }
      const nextIdx = (idx + direction + current.length) % current.length
      activateTab(current[nextIdx].id)
    },
    [activateTab]
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) {
        return
      }
      if (event.shiftKey && event.code === 'BracketRight') {
        event.preventDefault()
        cycleTab(1)
        return
      }
      if (event.shiftKey && event.code === 'BracketLeft') {
        event.preventDefault()
        cycleTab(-1)
        return
      }
      if (event.shiftKey) {
        return
      }
      if (event.key === 't') {
        event.preventDefault()
        newTab()
      } else if (event.key === 'w') {
        event.preventDefault()
        closeTab(activeTabId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTabId, closeTab, cycleTab, newTab])

  const tabDescriptors = useMemo<TabDescriptor[]>(() => {
    return tabs.map((tab) => {
      const hasRepo = tab.kind === 'repo' || tab.kind === 'opening-repo'
      const repoPath = hasRepo ? tab.repoPath : null
      const title = repoPath
        ? (repoPath.split(/[/\\]/).filter(Boolean).at(-1) ?? 'New tab')
        : 'New tab'
      return { id: tab.id, title, hasRepo, repoPath }
    })
  }, [tabs])

  const persistedSnapshot = useMemo<PersistedTabState>(() => {
    const repositories = tabs.map((tab) => (tab.kind === 'repo' ? tab.repoRef : null))
    const activeIndex = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === activeTabId)
    )
    return { tabs: repositories, activeIndex }
  }, [activeTabId, tabs])

  return {
    tabs,
    activeTabId,
    setActiveTabId: activateTab,
    tabDescriptors,
    newTab,
    closeTab,
    openRepoInTab,
    confirmRepoOpen,
    cancelRepoOpen,
    persistedSnapshot
  }
}
