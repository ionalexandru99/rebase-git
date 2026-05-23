import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TabDescriptor } from '@/components/TabBar'

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

export function useTabs(persisted?: PersistedTabState) {
  const initial = useRef<ReturnType<typeof hydrateFromPersisted> | null>(null)
  if (initial.current === null) initial.current = hydrateFromPersisted(persisted)
  const [tabs, setTabs] = useState<TabRecord[]>(initial.current.tabs)
  const [activeTabId, setActiveTabId] = useState<string>(initial.current.activeTabId)
  const [tabRepos, setTabRepos] = useState<Record<string, string | null>>(initial.current.tabRepos)

  const reportTabRepo = useCallback((id: string, path: string | null) => {
    setTabRepos((prev) => {
      if (prev[id] === path) return prev
      return { ...prev, [id]: path }
    })
  }, [])

  const newTab = useCallback(() => {
    const id = nextTabId()
    setTabs((prev) => [...prev, { id }])
    setActiveTabId(id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      if (tabs.length <= 1) {
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
      const idx = tabs.findIndex((tab) => tab.id === id)
      const next = tabs.filter((tab) => tab.id !== id)
      setTabs(next)
      setActiveTabId((current) => {
        if (current !== id) return current
        return next[Math.min(idx, next.length - 1)].id
      })
      setTabRepos((prev) => {
        if (!(id in prev)) return prev
        const { [id]: _removed, ...rest } = prev
        return rest
      })
    },
    [tabs]
  )

  const requestOpenRepo = useCallback(
    (sourceTabId: string, path: string): boolean => {
      const match = Object.entries(tabRepos).find(
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
    },
    [tabRepos]
  )

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      if (tabs.length <= 1) return
      const idx = tabs.findIndex((tab) => tab.id === activeTabId)
      if (idx === -1) return
      const nextIdx = (idx + direction + tabs.length) % tabs.length
      setActiveTabId(tabs[nextIdx].id)
    },
    [activeTabId, tabs]
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      if (event.shiftKey && event.key === ']') {
        event.preventDefault()
        cycleTab(1)
        return
      }
      if (event.shiftKey && event.key === '[') {
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
        closeTab(activeTabId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTabId, closeTab, newTab, cycleTab])

  const tabDescriptors = useMemo<TabDescriptor[]>(
    () =>
      tabs.map((tab) => {
        const path = tabRepos[tab.id] ?? null
        const title = path ? (path.split('/').filter(Boolean).at(-1) ?? 'New tab') : 'New tab'
        return { id: tab.id, title, hasRepo: Boolean(path) }
      }),
    [tabs, tabRepos]
  )

  const persistedSnapshot = useMemo<PersistedTabState>(() => {
    const paths = tabs.map((tab) => tabRepos[tab.id] ?? null)
    const activeIndex = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === activeTabId)
    )
    return { tabs: paths, activeIndex }
  }, [tabs, tabRepos, activeTabId])

  const initialRepoPath = useCallback(
    (id: string): string | null => initial.current?.tabRepos[id] ?? null,
    []
  )

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
