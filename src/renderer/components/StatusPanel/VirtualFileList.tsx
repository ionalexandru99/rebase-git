import { useMemo } from 'react'
import type { FileAction } from '@/lib/git-actions'
import { buildUnifiedFileRows, type UnifiedFileRow } from '@/lib/status-file-rows'
import { STATUS_FILE_OVERSCAN, STATUS_FILE_ROW_HEIGHT } from '@/lib/virtual-config'
import type { GitStatus } from '@/types'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { FileRow } from './FileRow'

export interface SelectedFile {
  file: string
}

interface VirtualFileListProps {
  status: GitStatus
  selected: SelectedFile | null
  onSelect: (file: string) => void
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  onFileAction?: (action: FileAction, file: string) => void
}

function StatusVirtualRow(props: {
  row: UnifiedFileRow
  top: number
  selected: SelectedFile | null
  onSelect: (file: string) => void
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  onFileAction?: (action: FileAction, file: string) => void
}) {
  const rowStyle = {
    top: '0',
    height: `${STATUS_FILE_ROW_HEIGHT}px`,
    transform: `translateY(${props.top}px)`
  }

  return (
    <li className="absolute inset-x-0 list-none" style={rowStyle}>
      <FileRow
        file={props.row.file}
        display={props.row.display}
        kind={props.row.fileKind}
        stageState={props.row.stageState}
        isSelected={props.selected?.file === props.row.file}
        onSelect={props.onSelect}
        onStage={props.onStage}
        onUnstage={props.onUnstage}
        onFileAction={props.onFileAction}
      />
    </li>
  )
}

export function VirtualFileList(props: VirtualFileListProps) {
  const rows = useMemo(() => buildUnifiedFileRows(props.status), [props.status])
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
              key={row.file}
              row={row}
              top={virtualItem.start}
              selected={props.selected}
              onSelect={props.onSelect}
              onStage={props.onStage}
              onUnstage={props.onUnstage}
              onFileAction={props.onFileAction}
            />
          )
        })}
      </ul>
    </div>
  )
}
