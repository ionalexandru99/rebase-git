import { createMemo, For } from 'solid-js'
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
      <div
        class="absolute inset-x-0 px-1.5"
        style={{
          top: '0',
          height: `${STATUS_FILE_ROW_HEIGHT}px`,
          transform: `translateY(${props.top}px)`
        }}
      >
        <div class="flex h-full items-center justify-between px-2">
          <span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {props.row.label}
          </span>
          <span class="text-xs tabular-nums text-muted-foreground">{props.row.count}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      class="absolute inset-x-0"
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
    </div>
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
      class="min-h-0 min-h-[480px] flex-1 overflow-auto px-1.5 pb-3 pt-2"
      data-testid="status-file-scroll"
    >
      <div class="relative" style={{ height: `${totalHeight()}px` }}>
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
      </div>
    </div>
  )
}
