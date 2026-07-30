import { useMemo } from 'react'
import type { ConflictLabels, ConflictSide } from '@/features/status/conflict-resolution'
import type { UnifiedFileRow } from '@/features/status/status-file-rows'
import type { FileRowGroup, StatusGroupKind } from '@/features/status/status-groups'
import type { FileAction } from '@/lib/git-actions'
import { STATUS_FILE_OVERSCAN, STATUS_FILE_ROW_HEIGHT } from '@/lib/virtual-config'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { FileRow } from './FileRow'

export interface SelectedFile {
  file: string
  renameSource?: string
  source?: 'worktree' | 'head-commit' | 'commit'
  group?: StatusGroupKind
  range?: string
  commit?: string
}

export interface FileListSection {
  key: FileRowGroup
  label: string
  rows: UnifiedFileRow[]
  action?: { label: string; onAction: () => void }
}

interface VirtualFileListProps {
  sections: FileListSection[]
  selected: SelectedFile | null
  onSelect: (file: string, group: FileRowGroup, renameSource?: string) => void
  onStage: (file: string) => void
  onUnstage: (file: string, renameSource?: string) => void
  onToggleDrop?: (file: string) => void
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
  conflictLabels?: ConflictLabels
  onResolveConflict?: (file: string, side: ConflictSide) => void
}

type StatusListItem =
  | { kind: 'section'; key: string; section: FileListSection }
  | { kind: 'file'; key: string; group: FileRowGroup; row: UnifiedFileRow }

const SECTION_MARKERS: Partial<Record<FileRowGroup, { glyph: string; className: string }>> = {
  conflicts: { glyph: '!', className: 'text-orange' },
  staged: { glyph: '✓', className: 'text-add' }
}

function selectedGroupOf(selected: SelectedFile | null): FileRowGroup | null {
  if (!selected) {
    return null
  }
  if (selected.source === 'head-commit') {
    return 'head-commit'
  }
  return selected.group ?? 'unstaged'
}

function StatusVirtualRow(props: {
  row: UnifiedFileRow
  group: FileRowGroup
  top: number
  isSelected: boolean
  onSelect: (file: string, group: FileRowGroup, renameSource?: string) => void
  onStage: (file: string) => void
  onUnstage: (file: string, renameSource?: string) => void
  onToggleDrop?: (file: string) => void
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
  conflictLabels?: ConflictLabels
  onResolveConflict?: (file: string, side: ConflictSide) => void
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
        renameSource={props.row.renameSource}
        display={props.row.display}
        kind={props.row.fileKind}
        group={props.group}
        dropState={props.row.dropState}
        isSelected={props.isSelected}
        onSelect={(file, renameSource) => {
          if (renameSource) {
            props.onSelect(file, props.group, renameSource)
            return
          }
          props.onSelect(file, props.group)
        }}
        onStage={props.onStage}
        onUnstage={props.onUnstage}
        onToggleDrop={props.onToggleDrop}
        onFileAction={props.onFileAction}
        conflictCode={props.row.conflictCode}
        conflictLabels={props.conflictLabels}
        onResolveConflict={props.onResolveConflict}
      />
    </li>
  )
}

function SectionHeading(props: { section: FileListSection; top: number }) {
  const marker = SECTION_MARKERS[props.section.key]
  return (
    <li
      className="absolute inset-x-0 flex list-none items-center gap-2 bg-card-2 px-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      style={{
        height: `${STATUS_FILE_ROW_HEIGHT}px`,
        transform: `translateY(${props.top}px)`
      }}
    >
      {marker ? (
        <span aria-hidden="true" className={`font-bold ${marker.className}`}>
          {marker.glyph}
        </span>
      ) : null}
      <h3 className="m-0 text-xs font-semibold">{props.section.label}</h3>
      <span className="tabular-nums">{props.section.rows.length}</span>
      <div className="flex-1" />
      {props.section.action ? (
        <button
          type="button"
          onClick={props.section.action.onAction}
          className="h-6 shrink-0 rounded-[var(--r-sm)] border bg-card px-2 text-[11px] font-medium normal-case tracking-normal text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
        >
          {props.section.action.label}
        </button>
      ) : null}
    </li>
  )
}

export function VirtualFileList(props: VirtualFileListProps) {
  const sections = props.sections
  const items = useMemo<StatusListItem[]>(
    () =>
      sections.flatMap((section) => [
        { kind: 'section' as const, key: `section:${section.key}`, section },
        ...section.rows.map((row) => ({
          kind: 'file' as const,
          key: `${section.key}:${row.file}`,
          group: section.key,
          row
        }))
      ]),
    [sections]
  )
  const { setScrollRef, onScroll, virtualItems, totalHeight } = useFixedVirtualizer({
    count: items.length,
    rowHeight: STATUS_FILE_ROW_HEIGHT,
    overscan: STATUS_FILE_OVERSCAN,
    initialViewportHeight: 480
  })
  const selectedGroup = selectedGroupOf(props.selected)

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
            return <SectionHeading key={item.key} section={item.section} top={virtualItem.start} />
          }
          return (
            <StatusVirtualRow
              key={item.key}
              row={item.row}
              group={item.group}
              top={virtualItem.start}
              isSelected={props.selected?.file === item.row.file && selectedGroup === item.group}
              onSelect={props.onSelect}
              onStage={props.onStage}
              onUnstage={props.onUnstage}
              onToggleDrop={props.onToggleDrop}
              onFileAction={props.onFileAction}
              conflictLabels={props.conflictLabels}
              onResolveConflict={props.onResolveConflict}
            />
          )
        })}
      </ul>
    </div>
  )
}
