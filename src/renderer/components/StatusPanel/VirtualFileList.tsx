import { createMemo, For } from '@/lib/react-compat'
import { buildStatusFileRows, type StatusFileRow } from '@/lib/status-file-rows'
import { STATUS_FILE_OVERSCAN, STATUS_FILE_ROW_HEIGHT } from '@/lib/virtual-config'
import type { GitStatus } from '@/types'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { Checkbox } from '../ui/checkbox'
import { FileRow } from './FileRow'

export interface SelectedFile {
  file: string
  staged: boolean
}

interface VirtualFileListProps {
  status: GitStatus
  selected: SelectedFile | null
  onSelect: (file: string, staged: boolean) => void
  onStage: (file: string) => void
  onUnstage: (file: string) => void
}

function StatusVirtualRow(props: {
  row: StatusFileRow
  top: number
  selected: SelectedFile | null
  onSelect: (file: string, staged: boolean) => void
  onStage: (file: string) => void
  onUnstage: (file: string) => void
}) {
  const rowStyle = {
    top: '0',
    height: `${STATUS_FILE_ROW_HEIGHT}px`,
    transform: `translateY(${props.top}px)`
  }

  if (props.row.kind === 'section') {
    const section = props.row
    const isStagedSection = section.sectionKind === 'staged'
    const toggleAll = () => {
      for (const file of section.files) {
        if (isStagedSection) {
          props.onUnstage(file)
        } else {
          props.onStage(file)
        }
      }
    }
    return (
      <li className="absolute inset-x-0 list-none" style={rowStyle}>
        <div className="flex h-full items-center gap-2 pl-1.5 pr-2">
          <Checkbox
            checked={isStagedSection && section.count > 0}
            aria-label={
              isStagedSection ? `Unstage all ${section.label}` : `Stage all ${section.label}`
            }
            onChange={toggleAll}
          />
          <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {section.label}
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {section.count}
          </span>
        </div>
      </li>
    )
  }

  const fileRow = props.row
  return (
    <li className="absolute inset-x-0 list-none" style={rowStyle}>
      <FileRow
        file={fileRow.file}
        display={fileRow.display}
        kind={fileRow.fileKind}
        isStaged={fileRow.isStaged}
        isSelected={
          props.selected?.file === fileRow.file && props.selected?.staged === fileRow.isStaged
        }
        onSelect={props.onSelect}
        onStage={props.onStage}
        onUnstage={props.onUnstage}
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
      className="min-h-0 flex-1 overflow-auto p-1.5"
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
                selected={props.selected}
                onSelect={props.onSelect}
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
