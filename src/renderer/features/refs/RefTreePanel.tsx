import { parseOrThrow } from '@shared/codec'
import { filterPersistedRefTreeToggles } from '@shared/ref-tree-toggles'
import { RefTreeTogglesSchema } from '@shared/schemas/ipc'
import { SearchIcon, XIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  type BranchTracking,
  buildRefTreeRows,
  REF_TREE_OVERSCAN,
  REF_TREE_ROW_HEIGHT,
  type RefKind,
  type RefRow,
  rowKey,
  type StashRowData
} from '@/features/refs/ref-tree'
import type { BranchAction, StashAction } from '@/lib/git-actions'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { RefTreeRow } from './RefTreeRow'

export type { RefKind } from '@/features/refs/ref-tree'

interface RefTreePanelProps {
  repoPath: string | null
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  stashes?: StashRowData[]
  currentBranch: string
  loading?: boolean
  tracking?: Record<string, BranchTracking>
  lastCommitAt?: Record<string, string>
  remoteLastCommitAt?: Record<string, string>
  tagLastCommitAt?: Record<string, string>
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
  onBranchAction?: (action: BranchAction, refKind: RefKind, fullPath: string) => void
  onStashAction?: (action: StashAction, index: number, expectedOid: string) => void
}

interface VirtualRefTreeRowProps {
  index: number
  top: number
  rows: RefRow[]
  localLoading: boolean
  currentBranch: string
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleCollapsed: (key: string) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
  onBranchAction?: (action: BranchAction, refKind: RefKind, fullPath: string) => void
  onStashAction?: (action: StashAction, index: number, expectedOid: string) => void
}

function VirtualRefTreeRow(props: VirtualRefTreeRowProps) {
  const row = props.rows[props.index]
  if (!row) {
    return null
  }
  return (
    <RefTreeRow
      row={row}
      top={props.top}
      localLoading={props.localLoading}
      currentBranch={props.currentBranch}
      visibleTimelineRefs={props.visibleTimelineRefs}
      onToggleCollapsed={props.onToggleCollapsed}
      onToggleTimelineVisibility={props.onToggleTimelineVisibility}
      onCheckoutLeaf={props.onCheckoutRef}
      onBranchAction={props.onBranchAction}
      onStashAction={props.onStashAction}
    />
  )
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
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

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

  const rows = useMemo(
    () =>
      buildRefTreeRows({
        localBranches: props.localBranches,
        remoteBranches: props.remoteBranches,
        tags: props.tags,
        toggles,
        currentBranch: props.currentBranch,
        localLoading: props.loading ?? false,
        tracking: props.tracking,
        freshness: {
          local: props.lastCommitAt,
          remote: props.remoteLastCommitAt,
          tag: props.tagLastCommitAt
        },
        stashes: props.stashes,
        query: deferredQuery
      }),
    [
      props.localBranches,
      props.remoteBranches,
      props.tags,
      toggles,
      props.currentBranch,
      props.loading,
      props.tracking,
      props.lastCommitAt,
      props.remoteLastCommitAt,
      props.tagLastCommitAt,
      props.stashes,
      deferredQuery
    ]
  )

  const { setScrollRef, onScroll, virtualItems, totalHeight, virtualizer } = useFixedVirtualizer({
    count: rows.length,
    rowHeight: REF_TREE_ROW_HEIGHT,
    overscan: REF_TREE_OVERSCAN,
    initialViewportHeight: 400
  })

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query.length > 0) {
      event.preventDefault()
      setQuery('')
    }
  }

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
    queueMicrotask(() => {
      virtualizer.measure()
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 pt-2">
        <div className="flex h-8 items-center gap-2 rounded-[var(--r-sm)] border bg-background px-2.5 text-muted-foreground transition-shadow focus-within:border-[var(--brand-line)] focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
          <SearchIcon className="size-3.5 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleQueryKeyDown}
            placeholder="Filter refs…"
            aria-label="Filter refs"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear filter"
              className="flex size-5 shrink-0 items-center justify-center rounded-[var(--r-xs)] hover:text-foreground"
              onClick={() => setQuery('')}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={setScrollRef}
        onScroll={onScroll}
        className="scroll-host min-h-0 flex-1 overflow-auto px-2 pb-2 pt-3 [scrollbar-gutter:stable]"
        data-testid="ref-tree-scroll"
      >
        <div className="relative" style={{ height: `${totalHeight}px` }}>
          {virtualItems.map((virtualItem) => {
            const row = rows[virtualItem.index]
            return (
              <VirtualRefTreeRow
                key={row ? rowKey(row) : virtualItem.key}
                index={virtualItem.index}
                top={virtualItem.start}
                rows={rows}
                localLoading={props.loading ?? false}
                currentBranch={props.currentBranch}
                visibleTimelineRefs={props.visibleTimelineRefs}
                onToggleCollapsed={toggle}
                onToggleTimelineVisibility={props.onToggleTimelineVisibility}
                onCheckoutRef={props.onCheckoutRef}
                onBranchAction={props.onBranchAction}
                onStashAction={props.onStashAction}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
