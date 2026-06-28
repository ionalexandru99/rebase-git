import type { FileAction } from '@/lib/git-actions'
import type { FileRowSource, UnifiedFileRow } from '@/lib/status-file-rows'
import { STATUS_FILE_OVERSCAN, STATUS_FILE_ROW_HEIGHT } from '@/lib/virtual-config'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { FileRow } from './FileRow'

export interface SelectedFile {
  file: string
  // 'head-commit' files are inspected read-only against `range`; absent/undefined means the working tree.
  source?: 'worktree' | 'head-commit'
  range?: string
}

interface VirtualFileListProps {
  rows: UnifiedFileRow[]
  selected: SelectedFile | null
  onSelect: (file: string, source: FileRowSource) => void
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  onToggleDrop?: (file: string) => void
  onFileAction?: (action: FileAction, file: string) => void
}

function StatusVirtualRow(props: {
  row: UnifiedFileRow
  top: number
  selected: SelectedFile | null
  onSelect: (file: string, source: FileRowSource) => void
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  onToggleDrop?: (file: string) => void
  onFileAction?: (action: FileAction, file: string) => void
}) {
  const rowStyle = {
    top: '0',
    height: `${STATUS_FILE_ROW_HEIGHT}px`,
    transform: `translateY(${props.top}px)`
  }
  const selectedSource = props.selected?.source ?? 'worktree'
  const isSelected = props.selected?.file === props.row.file && selectedSource === props.row.source

  return (
    <li className="absolute inset-x-0 list-none" style={rowStyle}>
      <FileRow
        file={props.row.file}
        display={props.row.display}
        kind={props.row.fileKind}
        stageState={props.row.stageState}
        source={props.row.source}
        dropState={props.row.dropState}
        isSelected={isSelected}
        onSelect={(file) => props.onSelect(file, props.row.source)}
        onStage={props.onStage}
        onUnstage={props.onUnstage}
        onToggleDrop={props.onToggleDrop}
        onFileAction={props.onFileAction}
      />
    </li>
  )
}

export function VirtualFileList(props: VirtualFileListProps) {
  const rows = props.rows
  const { setScrollRef, onScroll, virtualItems, totalHeight } = useFixedVirtualizer({
    count: rows.length,
    rowHeight: STATUS_FILE_ROW_HEIGHT,
    overscan: STATUS_FILE_OVERSCAN,
    initialViewportHeight: 480
  })

  return (
    <div
      ref={setScrollRef}
      onScroll={onScroll}
      className="scroll-host min-h-0 flex-1 overflow-auto p-1.5"
      data-testid="status-file-scroll"
    >
      <ul className="relative m-0 list-none p-0" style={{ height: `${totalHeight}px` }}>
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index]
          if (!row) {
            return null
          }
          return (
            <StatusVirtualRow
              key={`${row.source}:${row.file}`}
              row={row}
              top={virtualItem.start}
              selected={props.selected}
              onSelect={props.onSelect}
              onStage={props.onStage}
              onUnstage={props.onUnstage}
              onToggleDrop={props.onToggleDrop}
              onFileAction={props.onFileAction}
            />
          )
        })}
      </ul>
    </div>
  )
}
