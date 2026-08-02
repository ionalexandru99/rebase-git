import { parseOrThrow } from '@shared/codec'
import { filterPersistedRefTreeToggles } from '@shared/ref-tree-toggles'
import { RefTreeTogglesSchema } from '@shared/schemas/ipc'
import { useEffect, useRef, useState } from 'react'
import { RefTreePanelView, type RefTreePanelViewProps } from '@/features/refs/RefTreePanelView'

export type { RefKind } from '@/features/refs/ref-tree'

interface RefTreePanelProps extends Omit<RefTreePanelViewProps, 'toggles' | 'onToggleCollapsed'> {
  repoPath: string | null
}

const scopedTogglePrefix = (repoPath: string): string => `repo:${encodeURIComponent(repoPath)}:`

const togglesForRepo = (persisted: readonly string[], repoPath: string): Set<string> => {
  const prefix = scopedTogglePrefix(repoPath)
  return new Set(
    persisted.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
  )
}

async function persistToggles(repoPath: string, toggles: Set<string>): Promise<void> {
  const prefix = scopedTogglePrefix(repoPath)
  const current = parseOrThrow(RefTreeTogglesSchema, await window.electronAPI.getRefTreeToggles())
  const otherRepos = current.filter((key) => !key.startsWith(prefix))
  const scoped = filterPersistedRefTreeToggles([...toggles]).map((key) => `${prefix}${key}`)
  await window.electronAPI.setRefTreeToggles([...otherRepos, ...scoped])
}

let persistQueue = Promise.resolve()

function enqueuePersist(repoPath: string, toggles: Set<string>): void {
  persistQueue = persistQueue
    .then(() => persistToggles(repoPath, toggles))
    .catch((err: unknown) => {
      console.warn('[RefTreePanel] failed to persist toggles', err)
    })
}

export function RefTreePanel(props: RefTreePanelProps) {
  const [toggles, setToggles] = useState<Set<string>>(new Set())
  const togglesRef = useRef(toggles)

  useEffect(() => {
    const repoPath = props.repoPath
    const empty = new Set<string>()
    togglesRef.current = empty
    setToggles(empty)
    if (!repoPath) {
      return
    }
    let cancelled = false
    window.electronAPI
      .getRefTreeToggles()
      .then((res) => {
        if (cancelled) {
          return
        }
        const decoded = parseOrThrow(RefTreeTogglesSchema, res)
        const loaded = togglesForRepo(decoded, repoPath)
        togglesRef.current = loaded
        setToggles(loaded)
      })
      .catch((err: unknown) => {
        console.warn('[RefTreePanel] failed to load toggles', err)
      })
    return () => {
      cancelled = true
    }
  }, [props.repoPath])

  const toggle = (key: string) => {
    const next = new Set(togglesRef.current)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    togglesRef.current = next
    setToggles(next)
    const repoPath = props.repoPath
    if (repoPath) {
      enqueuePersist(repoPath, next)
    }
  }

  return <RefTreePanelView {...props} toggles={toggles} onToggleCollapsed={toggle} />
}
