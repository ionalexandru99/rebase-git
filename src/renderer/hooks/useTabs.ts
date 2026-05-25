import { type Accessor, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

export interface TabDescriptor {
  id: string
  title: string
  hasRepo: boolean
}

interface TabRecord {
  id: string
}

export interface PersistedTabState {
  tabs: (string | null)[]
  activeIndex: number
}

let tabSeq = 0
const nextTabId = () => `tab-${++tabSeq}-${Date.now()}`

function hydrateFromPersisted(persisted: PersistedTabState | undefined): {
  tabs: TabRecord[]
  activeTabId: string
  tabRepos: Record<string, string | null>
} {
  const sourcePaths =
    persisted && persisted.tabs.length > 0 ? persisted.tabs : ([null] as (string | null)[])
  const tabs = sourcePaths.map(() => ({ id: nextTabId() }))
  const tabRepos: Record<string, string | null> = {}
  for (let i = 0; i < tabs.length; i++) {
    tabRepos[tabs[i].id] = sourcePaths[i]
  }
  const activeIdx =
    persisted && persisted.activeIndex >= 0 && persisted.activeIndex < tabs.length
      ? persisted.activeIndex
      : 0
  return { tabs, activeTabId: tabs[activeIdx].id, tabRepos }
}

export interface TabsStore {
  tabs: Accessor<TabRecord[]>
  activeTabId: Accessor<string>
  setActiveTabId: (id: string) => void
  tabDescriptors: Accessor<TabDescriptor[]>
  newTab: () => void
  closeTab: (id: string) => void
  reportTabRepo: (id: string, path: string | null) => void
  requestOpenRepo: (sourceTabId: string, path: string) => boolean
  persistedSnapshot: Accessor<PersistedTabState>
  initialRepoPath: (id: string) => string | null
}

export function useTabs(persisted?: PersistedTabState): TabsStore {
  const initial = hydrateFromPersisted(persisted)
  const [tabs, setTabs] = createSignal<TabRecord[]>(initial.tabs)
  const [activeTabId, setActiveTabId] = createSignal<string>(initial.activeTabId)
  const [tabRepos, setTabRepos] = createSignal<Record<string, string | null>>(initial.tabRepos)

  const reportTabRepo = (id: string, path: string | null) => {
    setTabRepos((prev) => {
      if (prev[id] === path) return prev
      return { ...prev, [id]: path }
    })
  }

  const newTab = () => {
    const id = nextTabId()
    setTabs((prev) => [...prev, { id }])
    setActiveTabId(id)
  }

  const closeTab = (id: string) => {
    const current = tabs()
    if (current.length <= 1) {
      const freshId = nextTabId()
      setTabs([{ id: freshId }])
      setActiveTabId(freshId)
      setTabRepos((prev) => {
        if (!(id in prev)) return prev
        const { [id]: _removed, ...rest } = prev
        return rest
      })
      return
    }
    const idx = current.findIndex((tab) => tab.id === id)
    const next = current.filter((tab) => tab.id !== id)
    setTabs(next)
    if (activeTabId() === id) {
      setActiveTabId(next[Math.min(idx, next.length - 1)].id)
    }
    setTabRepos((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }

  const requestOpenRepo = (sourceTabId: string, path: string): boolean => {
    const match = Object.entries(tabRepos()).find(
      ([id, recorded]) => recorded === path && id !== sourceTabId
    )
    if (!match) return false
    const [existingId] = match
    setActiveTabId(existingId)
    setTabs((prev) => prev.filter((tab) => tab.id !== sourceTabId))
    setTabRepos((prev) => {
      if (!(sourceTabId in prev)) return prev
      const { [sourceTabId]: _removed, ...rest } = prev
      return rest
    })
    return true
  }

  const cycleTab = (direction: 1 | -1) => {
    const current = tabs()
    if (current.length <= 1) return
    const idx = current.findIndex((tab) => tab.id === activeTabId())
    if (idx === -1) return
    const nextIdx = (idx + direction + current.length) % current.length
    setActiveTabId(current[nextIdx].id)
  }

  onMount(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
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
      if (event.shiftKey) return
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
    const repos = tabRepos()
    return tabs().map((tab) => {
      const path = repos[tab.id] ?? null
      const title = path ? (path.split('/').filter(Boolean).at(-1) ?? 'New tab') : 'New tab'
      return { id: tab.id, title, hasRepo: Boolean(path) }
    })
  })

  const persistedSnapshot = createMemo<PersistedTabState>(() => {
    const repos = tabRepos()
    const paths = tabs().map((tab) => repos[tab.id] ?? null)
    const activeIndex = Math.max(
      0,
      tabs().findIndex((tab) => tab.id === activeTabId())
    )
    return { tabs: paths, activeIndex }
  })

  const initialRepoPath = (id: string): string | null => initial.tabRepos[id] ?? null

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    tabDescriptors,
    newTab,
    closeTab,
    reportTabRepo,
    requestOpenRepo,
    persistedSnapshot,
    initialRepoPath
  }
}
