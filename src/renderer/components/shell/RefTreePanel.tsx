import { decodeOrThrow } from '@shared/codec'
import { RefTreeToggles } from '@shared/schemas/ipc'
import { ChevronDown, ChevronRight, Cloud, GitBranch, Tag } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type RefKind = 'local' | 'remote' | 'tag'

interface RefLeafRow {
  kind: 'leaf'
  refKind: RefKind
  fullPath: string
  name: string
  depth: number
  isCurrent: boolean
}

interface RefFolderRow {
  kind: 'folder'
  refKind: RefKind
  fullPath: string
  name: string
  depth: number
  expanded: boolean
  childCount: number
}

interface RefSectionRow {
  kind: 'section'
  refKind: RefKind
  label: string
  count: number
  expanded: boolean
}

interface RefEmptyRow {
  kind: 'empty'
  refKind: RefKind
  label: string
}

interface RefSkeletonRow {
  kind: 'skeleton'
  refKind: RefKind
  idx: number
}

type Row = RefLeafRow | RefFolderRow | RefSectionRow | RefEmptyRow | RefSkeletonRow

const ROW_H = 28
const OVERSCAN = 20
const INDENT_PX = 12

function isSectionExpanded(toggles: Set<string>, refKind: RefKind): boolean {
  return !toggles.has(sectionKey(refKind))
}
function isFolderExpanded(toggles: Set<string>, refKind: RefKind, fullPath: string): boolean {
  return toggles.has(folderKey(refKind, fullPath))
}

interface RefTreePanelProps {
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  currentBranch: string
  loading?: boolean
  onSelectRef?: (refKind: RefKind, fullPath: string) => void
}

export const RefTreePanel = memo(function RefTreePanel({
  localBranches,
  remoteBranches,
  tags,
  currentBranch,
  loading = false,
  onSelectRef
}: RefTreePanelProps) {
  const [toggles, setToggles] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getRefTreeToggles()
      .then((res) => {
        if (cancelled) return
        const decoded = decodeOrThrow(RefTreeToggles, res)
        setToggles(new Set(decoded))
      })
      .catch((err: unknown) => {
        // Stored shape drifted or IPC failed; leave toggles at their default
        // (all sections expanded) rather than blowing up the sidebar.
        console.warn('[RefTreePanel] failed to load toggles', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = useCallback((key: string) => {
    setToggles((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      window.electronAPI.setRefTreeToggles([...next])
      return next
    })
  }, [])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const noData = localBranches.length === 0 && remoteBranches.length === 0 && tags.length === 0
    if (loading && noData) {
      pushSkeletonSection(out, 'local', 'Local branches', toggles, 4)
      pushSkeletonSection(out, 'remote', 'Remote branches', toggles, 3)
      pushSkeletonSection(out, 'tag', 'Tags', toggles, 2)
      return out
    }
    buildSection(out, 'local', 'Local branches', localBranches, toggles, currentBranch)
    buildSection(out, 'remote', 'Remote branches', remoteBranches, toggles, currentBranch)
    buildSection(out, 'tag', 'Tags', tags, toggles, currentBranch)
    return out
  }, [localBranches, remoteBranches, tags, currentBranch, toggles, loading])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      if (el.clientHeight > 0) setViewportH(el.clientHeight)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rafRef = useRef<number | null>(null)
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      setScrollTop(target.scrollTop)
    })
  }, [])
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    []
  )

  const totalHeight = rows.length * ROW_H
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-auto px-1"
      data-testid="ref-tree-scroll"
    >
      <div className="relative" style={{ height: totalHeight }}>
        {rows.slice(startIdx, endIdx).map((row, idx) => {
          const i = startIdx + idx
          return (
            <RowView
              key={rowKey(row)}
              row={row}
              top={i * ROW_H}
              loading={loading}
              onToggleCollapsed={toggle}
              onSelectLeaf={onSelectRef}
            />
          )
        })}
      </div>
    </div>
  )
})

function rowKey(r: Row): string {
  if (r.kind === 'section') return `s:${r.refKind}`
  if (r.kind === 'empty') return `e:${r.refKind}`
  if (r.kind === 'skeleton') return `sk:${r.refKind}:${r.idx}`
  return `${r.refKind}:${r.kind}:${r.fullPath}`
}

function pushSkeletonSection(
  out: Row[],
  refKind: RefKind,
  label: string,
  toggles: Set<string>,
  count: number
): void {
  const expanded = isSectionExpanded(toggles, refKind)
  out.push({ kind: 'section', refKind, label, count: 0, expanded })
  if (!expanded) return
  for (let i = 0; i < count; i++) {
    out.push({ kind: 'skeleton', refKind, idx: i })
  }
}

function sectionKey(refKind: RefKind): string {
  return `section:${refKind}`
}

function folderKey(refKind: RefKind, fullPath: string): string {
  return `folder:${refKind}:${fullPath}`
}

type TreeMap = Map<string, TreeMap | string>

function buildSection(
  out: Row[],
  refKind: RefKind,
  label: string,
  paths: string[],
  toggles: Set<string>,
  currentBranch: string
): void {
  const sectionExpanded = isSectionExpanded(toggles, refKind)
  out.push({
    kind: 'section',
    refKind,
    label,
    count: paths.length,
    expanded: sectionExpanded
  })
  if (!sectionExpanded) return
  if (paths.length === 0) {
    out.push({
      kind: 'empty',
      refKind,
      label: refKind === 'tag' ? 'No tags' : `No ${refKind} branches`
    })
    return
  }

  const root: TreeMap = new Map()
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLeaf = i === parts.length - 1
      if (isLeaf) {
        cur.set(part, path)
      } else {
        const next = cur.get(part)
        if (next instanceof Map) {
          cur = next
        } else {
          const fresh = new Map<string, TreeMap | string>()
          cur.set(part, fresh)
          cur = fresh
        }
      }
    }
  }

  walkTree(out, root, refKind, 1, '', toggles, currentBranch)
}

function walkTree(
  out: Row[],
  node: TreeMap,
  refKind: RefKind,
  depth: number,
  parentPath: string,
  toggles: Set<string>,
  currentBranch: string
): void {
  const entries = [...node.entries()].sort((a, b) => {
    const aIsFolder = a[1] instanceof Map
    const bIsFolder = b[1] instanceof Map
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1
    return a[0].localeCompare(b[0])
  })

  for (const [name, val] of entries) {
    const fullPath = parentPath ? `${parentPath}/${name}` : name
    if (val instanceof Map) {
      const expanded = isFolderExpanded(toggles, refKind, fullPath)
      out.push({
        kind: 'folder',
        refKind,
        fullPath,
        name,
        depth,
        expanded,
        childCount: val.size
      })
      if (expanded) {
        walkTree(out, val, refKind, depth + 1, fullPath, toggles, currentBranch)
      }
    } else {
      out.push({
        kind: 'leaf',
        refKind,
        fullPath: val,
        name,
        depth,
        isCurrent: refKind === 'local' && val === currentBranch
      })
    }
  }
}

interface RowViewProps {
  row: Row
  top: number
  loading: boolean
  onToggleCollapsed: (key: string) => void
  onSelectLeaf?: (refKind: RefKind, fullPath: string) => void
}

function RowView({ row, top, loading, onToggleCollapsed, onSelectLeaf }: RowViewProps) {
  const baseStyle: React.CSSProperties = {
    top: 0,
    height: ROW_H,
    transform: `translateY(${top}px)`,
    contain: 'layout paint style'
  }

  if (row.kind === 'section') {
    return (
      <button
        type="button"
        onClick={() => onToggleCollapsed(sectionKey(row.refKind))}
        className="absolute inset-x-0 flex items-center gap-1 px-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
        style={baseStyle}
      >
        <Chevron expanded={row.expanded} />
        <span>{row.label}</span>
        {loading ? (
          <Skeleton className="ml-auto h-2 w-4 rounded-sm" />
        ) : (
          <span className="ml-auto pr-1 tabular-nums opacity-60">{row.count}</span>
        )}
      </button>
    )
  }

  if (row.kind === 'empty') {
    return (
      <div
        className="absolute inset-x-0 flex items-center px-6 text-xs text-muted-foreground/70"
        style={baseStyle}
      >
        {row.label}
      </div>
    )
  }

  if (row.kind === 'skeleton') {
    const widths = ['60%', '78%', '52%', '70%']
    const w = widths[row.idx % widths.length]
    return (
      <div className="absolute inset-x-0 flex items-center gap-1.5 pr-2 pl-5" style={baseStyle}>
        <Skeleton className="size-3.5 shrink-0 rounded-sm opacity-60" />
        <Skeleton className="h-2.5 rounded" style={{ width: w, opacity: 0.6 }} />
      </div>
    )
  }

  if (row.kind === 'folder') {
    const padLeft = 6 + row.depth * INDENT_PX
    return (
      <button
        type="button"
        onClick={() => onToggleCollapsed(folderKey(row.refKind, row.fullPath))}
        className="absolute inset-x-0 flex items-center gap-1.5 rounded-sm pr-2 text-sm text-foreground/85 hover:bg-sidebar-accent/60 hover:text-foreground"
        style={{ ...baseStyle, paddingLeft: padLeft }}
        title={row.fullPath}
      >
        <Chevron expanded={row.expanded} />
        <span className="truncate">{row.name}</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">
          {row.childCount}
        </span>
      </button>
    )
  }

  const Icon = row.refKind === 'tag' ? Tag : row.refKind === 'remote' ? Cloud : GitBranch
  const padLeft = 6 + row.depth * INDENT_PX + 14
  return (
    <button
      type="button"
      onClick={() => onSelectLeaf?.(row.refKind, row.fullPath)}
      className={cn(
        'absolute inset-x-0 flex items-center gap-1.5 rounded-sm pr-2 text-sm hover:bg-sidebar-accent/60',
        row.isCurrent
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-foreground/90'
      )}
      style={{ ...baseStyle, paddingLeft: padLeft }}
      title={row.fullPath}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">{row.name}</span>
    </button>
  )
}

function Chevron({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
  )
}
