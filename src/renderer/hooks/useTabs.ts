import { type Accessor, createMemo, createSignal, onCleanup, onMount } from '@/lib/react-compat'

export interface TabDescriptor {
  id: string
  title: string
  hasRepo: boolean
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
  tabs: Accessor<TabRecord[]>
  activeTabId: Accessor<string>
  setActiveTabId: (id: string) => void
  tabDescriptors: Accessor<TabDescriptor[]>
  newTab: () => void
  closeTab: (id: string) => void
  openRepoInTab: (sourceTabId: string, path: string) => boolean
  confirmRepoOpen: (id: string, path: string) => void
  persistedSnapshot: Accessor<PersistedTabState>
}

export function useTabs(persisted?: PersistedTabState): TabsStore {
  const initial = hydrateFromPersisted(persisted)
  const [tabs, setTabs] = createSignal<TabRecord[]>(initial.tabs)
  const [activeTabId, setActiveTabId] = createSignal<string>(initial.activeTabId)

  const newTab = () => {
    const id = nextTabId()
    setTabs((prev) => [...prev, { id, kind: 'new' }])
    setActiveTabId(id)
  }

  const closeTab = (id: string) => {
    const current = tabs()
    if (current.length <= 1) {
      const freshId = nextTabId()
      setTabs([{ id: freshId, kind: 'new' }])
      setActiveTabId(freshId)
      return
    }
    const idx = current.findIndex((tab) => tab.id === id)
    const next = current.filter((tab) => tab.id !== id)
    setTabs(next)
    if (activeTabId() === id) {
      setActiveTabId(next[Math.min(idx, next.length - 1)].id)
    }
  }

  const openRepoInTab = (sourceTabId: string, path: string): boolean => {
    const match = tabs().find(
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
  }

  const confirmRepoOpen = (id: string, path: string) => {
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
  }

  const cycleTab = (direction: 1 | -1) => {
    const current = tabs()
    if (current.length <= 1) {
      return
    }
    const idx = current.findIndex((tab) => tab.id === activeTabId())
    if (idx === -1) {
      return
    }
    const nextIdx = (idx + direction + current.length) % current.length
    setActiveTabId(current[nextIdx].id)
  }

  onMount(() => {
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
        closeTab(activeTabId())
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  const tabDescriptors = createMemo<TabDescriptor[]>(() => {
    return tabs().map((tab) => {
      const title =
        tab.kind === 'repo' || tab.kind === 'opening-repo'
          ? (tab.repoPath.split(/[/\\]/).filter(Boolean).at(-1) ?? 'New tab')
          : 'New tab'
      return { id: tab.id, title, hasRepo: tab.kind === 'repo' || tab.kind === 'opening-repo' }
    })
  })

  const persistedSnapshot = createMemo<PersistedTabState>(() => {
    const paths = tabs().map((tab) => (tab.kind === 'repo' ? tab.repoPath : null))
    const activeIndex = Math.max(
      0,
      tabs().findIndex((tab) => tab.id === activeTabId())
    )
    return { tabs: paths, activeIndex }
  })

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
