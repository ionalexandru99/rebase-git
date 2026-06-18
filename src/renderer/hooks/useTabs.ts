import { useCallback, useEffect, useMemo, useState } from 'react'

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
}

interface OpeningRepoTabRecord {
  id: string
  kind: 'opening-repo'
  repoPath: string
}

export type TabRecord = NewTabRecord | RepoTabRecord | OpeningRepoTabRecord

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
  const tabs = sourcePaths.map<TabRecord>((path) =>
    path ? { id: nextTabId(), kind: 'repo', repoPath: path } : { id: nextTabId(), kind: 'new' }
  )
  const activeIdx =
    persisted && persisted.activeIndex >= 0 && persisted.activeIndex < tabs.length
      ? persisted.activeIndex
      : 0
  return { tabs, activeTabId: tabs[activeIdx].id }
}

export interface TabsStore {
  tabs: TabRecord[]
  activeTabId: string
  setActiveTabId: (id: string) => void
  tabDescriptors: TabDescriptor[]
  newTab: () => void
  closeTab: (id: string) => void
  openRepoInTab: (sourceTabId: string, path: string) => boolean
  confirmRepoOpen: (id: string, path: string) => void
  persistedSnapshot: PersistedTabState
}

export function useTabs(persisted?: PersistedTabState): TabsStore {
  const initial = hydrateFromPersisted(persisted)
  const [tabs, setTabs] = useState<TabRecord[]>(initial.tabs)
  const [activeTabId, setActiveTabId] = useState<string>(initial.activeTabId)

  const newTab = useCallback(() => {
    const id = nextTabId()
    setTabs((prev) => [...prev, { id, kind: 'new' }])
    setActiveTabId(id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      const current = tabs
      if (current.length <= 1) {
        const freshId = nextTabId()
        setTabs([{ id: freshId, kind: 'new' }])
        setActiveTabId(freshId)
        return
      }
      const idx = current.findIndex((tab) => tab.id === id)
      const next = current.filter((tab) => tab.id !== id)
      setTabs(next)
      if (activeTabId === id) {
        setActiveTabId(next[Math.min(idx, next.length - 1)].id)
      }
    },
    [activeTabId, tabs]
  )

  const openRepoInTab = useCallback(
    (sourceTabId: string, path: string): boolean => {
      const match = tabs.find(
        (tab) =>
          (tab.kind === 'repo' || tab.kind === 'opening-repo') &&
          sameRepoPath(tab.repoPath, path) &&
          tab.id !== sourceTabId
      )
      if (match) {
        setActiveTabId(match.id)
        setTabs((prev) => prev.filter((tab) => tab.id !== sourceTabId))
        return true
      }

      setTabs((prev) => {
        let found = false
        const next = prev.map((tab) => {
          if (tab.id !== sourceTabId) {
            return tab
          }
          found = true
          return { id: tab.id, kind: 'opening-repo', repoPath: path } satisfies OpeningRepoTabRecord
        })
        return found ? next : prev
      })
      setActiveTabId(sourceTabId)
      return false
    },
    [tabs]
  )

  const confirmRepoOpen = useCallback((id: string, path: string) => {
    setTabs((prev) => {
      let changed = false
      const next = prev.map((tab) => {
        if (tab.id !== id) {
          return tab
        }
        if (tab.kind === 'repo' && sameRepoPath(tab.repoPath, path)) {
          return tab
        }
        changed = true
        return { id, kind: 'repo', repoPath: path } satisfies RepoTabRecord
      })
      return changed ? next : prev
    })
  }, [])

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      const current = tabs
      if (current.length <= 1) {
        return
      }
      const idx = current.findIndex((tab) => tab.id === activeTabId)
      if (idx === -1) {
        return
      }
      const nextIdx = (idx + direction + current.length) % current.length
      setActiveTabId(current[nextIdx].id)
    },
    [activeTabId, tabs]
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
    setActiveTabId,
    tabDescriptors,
    newTab,
    closeTab,
    openRepoInTab,
    confirmRepoOpen,
    persistedSnapshot
  }
}
