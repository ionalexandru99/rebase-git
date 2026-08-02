import type { HeadCommitFile } from '@shared/schemas/git'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  assembleDrops,
  dropStateOf,
  type FileDrops,
  type HeadDropState,
  hunkDropped,
  toggleFileDrop,
  toggleHunkDrop
} from '@/features/commit/amend-drops'
import { buildHeadCommitRange } from '@/features/history/head-commit-range'
import type { SelectedFile } from '@/features/status/StatusPanel'
import { followSelection } from '@/features/status/selection-follow'
import { buildHeadCommitRows, type UnifiedFileRow } from '@/features/status/status-file-rows'
import {
  buildStatusGroups,
  type FileRowGroup,
  flattenStatusGroups,
  type StatusGroupRow
} from '@/features/status/status-groups'

interface LocalChangesSelectionInput {
  rows: readonly UnifiedFileRow[]
  headFiles: readonly HeadCommitFile[]
  headParentCount: number
  headSha?: string
  amendActive: boolean
}

export interface LocalChangesSelection {
  selected: SelectedFile | null
  amendRows: UnifiedFileRow[]
  droppedHeadPaths: string[]
  droppedHeadHunks: { file: string; hunks: string[] }[]
  amendDrop?: {
    dropState: HeadDropState
    isHunkDropped: (hunkHeader: string) => boolean
    onToggleFile: () => void
    onToggleHunk: (hunkHeader: string, allHeaders: string[]) => void
  }
  resetAmend: () => void
  selectFile: (file: string, group: FileRowGroup, renameSource?: string) => void
  toggleHeadFileDrop: (file: string) => void
}

export function useLocalChangesSelection(input: LocalChangesSelectionInput): LocalChangesSelection {
  const { rows, headFiles, headParentCount, headSha, amendActive } = input
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [drops, setDrops] = useState<FileDrops>(() => new Map())
  const amendRows = useMemo(
    () => (amendActive && headParentCount <= 1 ? buildHeadCommitRows([...headFiles], drops) : []),
    [amendActive, headParentCount, headFiles, drops]
  )
  const { droppedHeadPaths, droppedHeadHunks } = useMemo(
    () => assembleDrops(drops, amendRows),
    [amendRows, drops]
  )
  const groupRows = useMemo(() => flattenStatusGroups(buildStatusGroups(rows)), [rows])
  const previousGroupRows = useRef<StatusGroupRow[]>(groupRows)

  useEffect(() => {
    const previous = previousGroupRows.current
    previousGroupRows.current = groupRows
    if (selected?.source === 'head-commit') {
      return
    }
    const follow = followSelection({
      selected: selected ? { file: selected.file, group: selected.group ?? 'unstaged' } : null,
      previous,
      next: groupRows
    })
    if (follow.kind === 'keep') {
      return
    }
    setSelected(
      follow.kind === 'clear'
        ? null
        : { file: follow.file, renameSource: follow.renameSource, group: follow.group }
    )
  }, [groupRows, selected])

  const firstSelection = (): SelectedFile | null => {
    const first = groupRows[0]
    return first
      ? { file: first.row.file, renameSource: first.row.renameSource, group: first.group }
      : null
  }

  const resetAmend = () => {
    setDrops(new Map())
    setSelected((current) => (current?.source === 'head-commit' ? firstSelection() : current))
  }

  const selectFile = (file: string, group: FileRowGroup, renameSource?: string) => {
    if (group !== 'head-commit') {
      setSelected({ file, renameSource, group })
      return
    }
    if (!headSha) {
      return
    }
    setSelected({
      file,
      renameSource,
      source: 'head-commit',
      range: buildHeadCommitRange(headParentCount, headSha)
    })
  }

  const toggleHeadFileDrop = (file: string) => {
    setDrops((current) => toggleFileDrop(current, file))
  }

  const toggleHeadHunkDrop = (file: string, hunkHeader: string, allHeaders: string[]) => {
    setDrops((current) => toggleHunkDrop(current, file, hunkHeader, allHeaders))
  }

  const amendDrop =
    selected?.source === 'head-commit'
      ? {
          dropState: dropStateOf(drops, selected.file),
          isHunkDropped: (hunkHeader: string) => hunkDropped(drops, selected.file, hunkHeader),
          onToggleFile: () => toggleHeadFileDrop(selected.file),
          onToggleHunk: (hunkHeader: string, allHeaders: string[]) =>
            toggleHeadHunkDrop(selected.file, hunkHeader, allHeaders)
        }
      : undefined

  return {
    selected,
    amendRows,
    droppedHeadPaths,
    droppedHeadHunks,
    amendDrop,
    resetAmend,
    selectFile,
    toggleHeadFileDrop
  }
}
