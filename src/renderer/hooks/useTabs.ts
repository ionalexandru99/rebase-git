import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  openRevision?: number
}

interface OpeningRepoTabRecord {
  id: string
  kind: 'opening-repo'
  repoPath: string
}

interface FailedRepoTabRecord {
  id: string
  kind: 'failed-repo'
  repoPath: string
}

export type TabRecord = NewTabRecord | RepoTabRecord | OpeningRepoTabRecord | FailedRepoTabRecord

export interface PersistedTabState {
  tabs: (string | null)[]
  activeIndex: number
}

let tabSeq = 0
const nextTabId = () => `tab-${++tabSeq}-${Date.now()}`

const repoPathKey = (repoPath: string): string =>
  repoPath
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .filter(Boolean)
    .join('/')

const sameRepoPath = (left: string, right: string): boolean =>
  repoPathKey(left) === repoPathKey(right)

function hydrateFromPersisted(persisted: PersistedTabState | undefined): {
  tabs: TabRecord[]
  activeTabId: string
} {
  const sourcePaths =
    persisted && persisted.tabs.length > 0 ? persisted.tabs : ([null] as (string | null)[])
  const tabs: TabRecord[] = []
  const hydratedIds: string[] = []
  const repoIdsByPath = new Map<string, string>()
  for (const path of sourcePaths) {
    if (!path) {
      const tab = { id: nextTabId(), kind: 'new' } satisfies NewTabRecord
      tabs.push(tab)
      hydratedIds.push(tab.id)
      continue
    }
    const key = repoPathKey(path)
    const existingId = repoIdsByPath.get(key)
    if (existingId) {
      hydratedIds.push(existingId)
      continue
    }
    const tab = { id: nextTabId(), kind: 'repo', repoPath: path } satisfies RepoTabRecord
    tabs.push(tab)
    hydratedIds.push(tab.id)
    repoIdsByPath.set(key, tab.id)
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
  openRepoInTab: (sourceTabId: string, path: string) => boolean
  confirmRepoOpen: (id: string, path: string) => boolean
  cancelRepoOpen: (id: string, path: string) => void
  persistedSnapshot: PersistedTabState
}

export function useTabs(persisted?: PersistedTabState): TabsStore {
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
    (sourceTabId: string, path: string): boolean => {
      const current = tabsRef.current
      const match = current.find(
        (tab) =>
          (tab.kind === 'repo' || tab.kind === 'opening-repo') &&
          sameRepoPath(tab.repoPath, path) &&
          tab.id !== sourceTabId
      )
      if (match) {
        activateTab(match.id)
        replaceTabs(current.filter((tab) => tab.id !== sourceTabId))
        return true
      }

      const next = current.map((tab) =>
        tab.id === sourceTabId
          ? ({ id: tab.id, kind: 'opening-repo', repoPath: path } satisfies OpeningRepoTabRecord)
          : tab
      )
      replaceTabs(next)
      activateTab(sourceTabId)
      return false
    },
    [activateTab, replaceTabs]
  )

  const confirmRepoOpen = useCallback(
    (id: string, path: string): boolean => {
      const current = tabsRef.current
      const existing = current.find(
        (tab) =>
          tab.id !== id &&
          (tab.kind === 'repo' || tab.kind === 'opening-repo') &&
          sameRepoPath(tab.repoPath, path)
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
        tab.id === id ? ({ ...tab, id, kind: 'repo', repoPath: path } satisfies RepoTabRecord) : tab
      )
      replaceTabs(next)
      return true
    },
    [activateTab, replaceTabs]
  )

  const cancelRepoOpen = useCallback(
    (id: string, path: string) => {
      const current = tabsRef.current
      const next = current.map((tab) =>
        tab.id === id && tab.kind === 'opening-repo' && sameRepoPath(tab.repoPath, path)
          ? ({ id, kind: 'failed-repo', repoPath: path } satisfies FailedRepoTabRecord)
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
    const paths = tabs.map((tab) => (tab.kind === 'repo' ? tab.repoPath : null))
    const activeIndex = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === activeTabId)
    )
    return { tabs: paths, activeIndex }
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
