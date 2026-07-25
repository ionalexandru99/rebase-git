import type { CommitDetailFile, CommitFileStatus } from '@shared/schemas/git'
import { cn } from '@/lib/utils'
import { STATUS_FILE_OVERSCAN, STATUS_FILE_ROW_HEIGHT } from '@/lib/virtual-config'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { StatusBadge, type StatusKind } from '../status/StatusBadge'

const BADGE_KIND: Record<CommitFileStatus, StatusKind> = {
  A: 'created',
  M: 'modified',
  D: 'deleted',
  R: 'renamed'
}

interface CommitFileListProps {
  files: readonly CommitDetailFile[]
  selectedPath: string | null
  onSelect: (file: CommitDetailFile) => void
}

export function CommitFileList(props: CommitFileListProps) {
  const { setScrollRef, onScroll, virtualItems, totalHeight } = useFixedVirtualizer({
    count: props.files.length,
    rowHeight: STATUS_FILE_ROW_HEIGHT,
    overscan: STATUS_FILE_OVERSCAN,
    initialViewportHeight: 240
  })

  return (
    <div
      ref={setScrollRef}
      onScroll={onScroll}
      className="scroll-host min-h-0 flex-1 overflow-auto p-1.5"
      data-testid="commit-file-scroll"
    >
      <ul className="relative m-0 list-none p-0" style={{ height: `${totalHeight}px` }}>
        {virtualItems.map((virtualItem) => {
          const file = props.files[virtualItem.index]
          if (!file) {
            return null
          }
          return (
            <li
              key={file.path}
              className="absolute inset-x-0 list-none"
              style={{
                height: `${STATUS_FILE_ROW_HEIGHT}px`,
                transform: `translateY(${virtualItem.start}px)`
              }}
            >
              <CommitFileRow
                file={file}
                isSelected={file.path === props.selectedPath}
                onSelect={() => props.onSelect(file)}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CommitFileRow(props: {
  file: CommitDetailFile
  isSelected: boolean
  onSelect: () => void
}) {
  const file = props.file
  const label = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path

  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-current={props.isSelected}
      data-testid="commit-file-row"
      className={cn(
        'grid h-8 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--r-sm)] px-2 text-left transition-colors',
        props.isSelected ? 'bg-[var(--brand-soft)]' : 'hover:bg-muted'
      )}
    >
      <StatusBadge kind={BADGE_KIND[file.status]} />
      <span className="min-w-0 truncate text-sm" title={label}>
        {label}
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
