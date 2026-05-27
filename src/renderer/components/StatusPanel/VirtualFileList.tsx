import { createMemo, For } from '@/lib/react-compat'
import { buildStatusFileRows, type StatusFileRow } from '@/lib/status-file-rows'
import { STATUS_FILE_OVERSCAN, STATUS_FILE_ROW_HEIGHT } from '@/lib/virtual-config'
import type { GitStatus } from '@/types'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { FileRow } from './FileRow'

interface VirtualFileListProps {
  status: GitStatus
  onStage: (file: string) => void
  onUnstage: (file: string) => void
}

function StatusVirtualRow(props: {
  row: StatusFileRow
  top: number
  onStage: (file: string) => void
  onUnstage: (file: string) => void
}) {
  if (props.row.kind === 'section') {
    return (
      <li
        className="absolute inset-x-0 list-none px-1.5"
        style={{
          top: '0',
          height: `${STATUS_FILE_ROW_HEIGHT}px`,
          transform: `translateY(${props.top}px)`
        }}
      >
        <div className="flex h-full items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {props.row.label}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{props.row.count}</span>
        </div>
      </li>
    )
  }

  return (
    <li
      className="absolute inset-x-0 list-none"
      style={{
        top: '0',
        height: `${STATUS_FILE_ROW_HEIGHT}px`,
        transform: `translateY(${props.top}px)`
      }}
    >
      <FileRow
        file={props.row.file}
        display={props.row.display}
        kind={props.row.fileKind}
        actionLabel={props.row.actionLabel}
        onAction={props.row.actionLabel === 'Unstage' ? props.onUnstage : props.onStage}
      />
    </li>
  )
}

export function VirtualFileList(props: VirtualFileListProps) {
  const rows = createMemo(() => buildStatusFileRows(props.status))
  const { setScrollRef, onScroll, virtualItems, totalHeight } = useFixedVirtualizer({
    count: () => rows().length,
    rowHeight: STATUS_FILE_ROW_HEIGHT,
    overscan: STATUS_FILE_OVERSCAN,
    initialViewportHeight: 480
  })

  return (
    <div
      ref={setScrollRef}
      onScroll={onScroll}
      className="min-h-0 min-h-[480px] flex-1 overflow-auto px-1.5 pb-3 pt-2"
      data-testid="status-file-scroll"
    >
      <ul className="relative m-0 list-none p-0" style={{ height: `${totalHeight()}px` }}>
        <For each={virtualItems()}>
          {(virtualItem) => {
            const row = rows()[virtualItem.index]
            if (!row) {
              return null
            }
            return (
              <StatusVirtualRow
                row={row}
                top={virtualItem.start}
                onStage={props.onStage}
                onUnstage={props.onUnstage}
              />
            )
          }}
        </For>
      </ul>
    </div>
  )
}
