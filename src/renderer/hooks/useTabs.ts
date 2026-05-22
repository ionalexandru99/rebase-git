import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TabDescriptor } from '@/components/TabBar'

interface TabRecord {
  id: string
}

let tabSeq = 0
const nextTabId = () => `tab-${++tabSeq}-${Date.now()}`

export function useTabs() {
  const [tabs, setTabs] = useState<TabRecord[]>(() => [{ id: nextTabId() }])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id ?? '')
  const [tabRepos, setTabRepos] = useState<Record<string, string | null>>({})

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
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
  }, [activeTabId, closeTab, newTab])

  const tabDescriptors = useMemo<TabDescriptor[]>(
    () =>
      tabs.map((tab) => {
        const path = tabRepos[tab.id] ?? null
        const title = path ? (path.split('/').filter(Boolean).at(-1) ?? 'New tab') : 'New tab'
        return { id: tab.id, title, hasRepo: Boolean(path) }
      }),
    [tabs, tabRepos]
  )

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    tabDescriptors,
    newTab,
    closeTab,
    reportTabRepo,
    requestOpenRepo
  }
}
