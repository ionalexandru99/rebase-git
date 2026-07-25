import type { CommitDetailFile, CommitFileStatus } from '@shared/schemas/git'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { STATUS_FILE_OVERSCAN, STATUS_FILE_ROW_HEIGHT } from '@/lib/virtual-config'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { StatusBadge, type StatusKind } from '../status/StatusBadge'
import {
  buildCommitFileTreeRows,
  type CommitTreeDirectoryRow,
  type CommitTreeFileRow
} from './commit-file-tree'

const BADGE_KIND: Record<CommitFileStatus, StatusKind> = {
  A: 'created',
  M: 'modified',
  D: 'deleted',
  R: 'renamed'
}

const INDENT_PX = 12
const CHEVRON_COLUMN_PX = 22

interface CommitFileListProps {
  files: readonly CommitDetailFile[]
  selectedPath: string | null
  onSelect: (file: CommitDetailFile) => void
}

export function CommitFileList(props: CommitFileListProps) {
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set())
  const rows = useMemo(
    () => buildCommitFileTreeRows(props.files, collapsedDirs),
    [props.files, collapsedDirs]
  )
  const { setScrollRef, onScroll, virtualItems, totalHeight } = useFixedVirtualizer({
    count: rows.length,
    rowHeight: STATUS_FILE_ROW_HEIGHT,
    overscan: STATUS_FILE_OVERSCAN,
    initialViewportHeight: 240
  })

  const toggleDirectory = (key: string) => {
    setCollapsedDirs((current) => {
      const next = new Set(current)
      if (!next.delete(key)) {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div
      ref={setScrollRef}
      onScroll={onScroll}
      className="scroll-host min-h-0 flex-1 overflow-auto p-1.5"
      data-testid="commit-file-scroll"
    >
      <ul className="relative m-0 list-none p-0" style={{ height: `${totalHeight}px` }}>
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index]
          if (!row) {
            return null
          }
          return (
            <li
              key={row.key}
              className="absolute inset-x-0 list-none"
              style={{
                height: `${STATUS_FILE_ROW_HEIGHT}px`,
                transform: `translateY(${virtualItem.start}px)`
              }}
            >
              {row.kind === 'directory' ? (
                <DirectoryRow row={row} onToggle={() => toggleDirectory(row.key)} />
              ) : (
                <FileRow
                  row={row}
                  isSelected={row.file.path === props.selectedPath}
                  onSelect={() => props.onSelect(row.file)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// No display utility here: each row type sets its own, so the two never race in the stylesheet.
const ROW_CLASS =
  'h-8 w-full items-center gap-2 rounded-[var(--r-sm)] pr-2 text-left transition-colors'

function DirectoryRow(props: { row: CommitTreeDirectoryRow; onToggle: () => void }) {
  const row = props.row
  const Chevron = row.collapsed ? ChevronRightIcon : ChevronDownIcon

  return (
    <button
      type="button"
      onClick={props.onToggle}
      aria-expanded={!row.collapsed}
      data-testid="commit-directory-row"
      className={cn(ROW_CLASS, 'flex hover:bg-muted')}
      style={{ paddingLeft: `${8 + row.depth * INDENT_PX}px` }}
    >
      <Chevron aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate text-sm text-muted-foreground" title={row.label}>
        {row.label}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
        {row.fileCount}
      </span>
    </button>
  )
}

function FileRow(props: { row: CommitTreeFileRow; isSelected: boolean; onSelect: () => void }) {
  const file = props.row.file

  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-current={props.isSelected}
      data-testid="commit-file-row"
      className={cn(
        ROW_CLASS,
        'grid grid-cols-[18px_minmax(0,1fr)_auto]',
        props.isSelected ? 'bg-[var(--brand-soft)]' : 'hover:bg-muted'
      )}
      // Files line up past the chevron column, which is a directory-only affordance.
      style={{ paddingLeft: `${8 + props.row.depth * INDENT_PX + CHEVRON_COLUMN_PX}px` }}
    >
      <StatusBadge kind={BADGE_KIND[file.status]} />
      <span className="min-w-0 truncate text-sm" title={props.row.label}>
        {props.row.label}
      </span>
      {file.binary ? (
        <span className="shrink-0 text-xs text-muted-foreground">binary</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
          <span className="text-add">+{file.additions}</span>
          <span className="text-del">−{file.deletions}</span>
        </span>
      )}
    </button>
  )
}
