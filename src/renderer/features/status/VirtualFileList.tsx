import { useMemo } from 'react'
import type { FileRowSource, UnifiedFileRow } from '@/features/status/status-file-rows'
import type { FileAction } from '@/lib/git-actions'
import { STATUS_FILE_OVERSCAN, STATUS_FILE_ROW_HEIGHT } from '@/lib/virtual-config'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { FileRow } from './FileRow'

export interface SelectedFile {
  file: string
  renameSource?: string
  source?: 'worktree' | 'head-commit'
  range?: string
}

export interface FileListSection {
  label: string
  rows: UnifiedFileRow[]
}

export type FileListInput =
  | { kind: 'flat'; rows: UnifiedFileRow[] }
  | { kind: 'sections'; sections: FileListSection[] }

interface VirtualFileListProps {
  input: FileListInput
  selected: SelectedFile | null
  onSelect: (file: string, source: FileRowSource, renameSource?: string) => void
  onStage: (file: string) => void
  onUnstage: (file: string, renameSource?: string) => void
  onToggleDrop?: (file: string) => void
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
}

type StatusListItem =
  | { kind: 'section'; key: string; label: string; count: number }
  | { kind: 'file'; key: string; row: UnifiedFileRow }

function StatusVirtualRow(props: {
  row: UnifiedFileRow
  top: number
  selected: SelectedFile | null
  onSelect: (file: string, source: FileRowSource, renameSource?: string) => void
  onStage: (file: string) => void
  onUnstage: (file: string, renameSource?: string) => void
  onToggleDrop?: (file: string) => void
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
  showSource: boolean
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
        renameSource={props.row.renameSource}
        display={props.row.display}
        kind={props.row.fileKind}
        stageState={props.row.stageState}
        source={props.row.source}
        dropState={props.row.dropState}
        isSelected={isSelected}
        onSelect={(file, renameSource) => {
          if (renameSource) {
            props.onSelect(file, props.row.source, renameSource)
            return
          }
          props.onSelect(file, props.row.source)
        }}
        onStage={props.onStage}
        onUnstage={props.onUnstage}
        onToggleDrop={props.onToggleDrop}
        onFileAction={props.onFileAction}
        showSource={props.showSource}
      />
    </li>
  )
}

export function VirtualFileList(props: VirtualFileListProps) {
  const input = props.input
  const items = useMemo<StatusListItem[]>(() => {
    if (input.kind === 'flat') {
      return input.rows.map((row) => ({
        kind: 'file',
        key: `${row.source}:${row.file}`,
        row
      }))
    }
    return input.sections.flatMap((section) => [
      {
        kind: 'section' as const,
        key: `section:${section.label}`,
        label: section.label,
        count: section.rows.length
      },
      ...section.rows.map((row) => ({
        kind: 'file' as const,
        key: `${row.source}:${row.file}`,
        row
      }))
    ])
  }, [input])
  const { setScrollRef, onScroll, virtualItems, totalHeight } = useFixedVirtualizer({
    count: items.length,
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
          const item = items[virtualItem.index]
          if (!item) {
            return null
          }
          if (item.kind === 'section') {
            return (
              <li
                key={item.key}
                className="absolute inset-x-0 flex list-none items-center justify-between bg-card-2 px-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                style={{
                  height: `${STATUS_FILE_ROW_HEIGHT}px`,
                  transform: `translateY(${virtualItem.start}px)`
                }}
              >
                <h3 className="m-0 text-xs font-semibold">{item.label}</h3>
                <span className="tabular-nums">{item.count}</span>
              </li>
            )
          }
          return (
            <StatusVirtualRow
              key={item.key}
              row={item.row}
              top={virtualItem.start}
              selected={props.selected}
              onSelect={props.onSelect}
              onStage={props.onStage}
              onUnstage={props.onUnstage}
              onToggleDrop={props.onToggleDrop}
              onFileAction={props.onFileAction}
              showSource={input.kind === 'flat' && item.row.source === 'head-commit'}
            />
          )
        })}
      </ul>
    </div>
  )
}
