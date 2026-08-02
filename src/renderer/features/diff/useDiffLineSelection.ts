import type { SelectedLineRange } from '@pierre/diffs'
import type { HunkLineSelection } from '@shared/rpc'
import type { ParsedHunk } from '@shared/unified-diff'
import { useCallback, useRef, useState } from 'react'
import {
  mapSelectionToHunkSelections,
  type SelectedChangeLine,
  sweepSelectedChangeLines
} from './line-selection'

interface PendingLineSelection {
  file: string
  staged: boolean
  patchKey: string
  lines: SelectedChangeLine[]
}

type ApplyLines = (file: string, selections: readonly HunkLineSelection[]) => Promise<boolean>

interface DiffLineSelectionOptions {
  selectedFile: string | null
  showsStagedSide: boolean
  patch: string | undefined
  patchKey: string | null
  hunks: readonly ParsedHunk[]
  stageLines: ApplyLines
  unstageLines: ApplyLines
  collectSelectedLines?: (root: ParentNode) => SelectedChangeLine[]
  scheduleFrame?: (callback: () => void) => void
}

const SELECTION_SWEEP_MAX_FRAMES = 12
const scheduleAnimationFrame = (callback: () => void) => requestAnimationFrame(callback)

export function useDiffLineSelection(options: DiffLineSelectionOptions) {
  const {
    selectedFile,
    showsStagedSide,
    patch,
    patchKey,
    hunks,
    stageLines,
    unstageLines,
    collectSelectedLines = sweepSelectedChangeLines,
    scheduleFrame = scheduleAnimationFrame
  } = options
  const [lineSelection, setLineSelection] = useState<PendingLineSelection | null>(null)
  const diffBodyRef = useRef<HTMLDivElement | null>(null)
  const sweepGeneration = useRef(0)

  const activeLineSelection =
    lineSelection &&
    lineSelection.file === selectedFile &&
    lineSelection.staged === showsStagedSide &&
    lineSelection.patchKey === patchKey
      ? lineSelection
      : null

  const onLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      const generation = ++sweepGeneration.current
      if (!range || !selectedFile || patchKey === null) {
        setLineSelection(null)
        return
      }
      setLineSelection(null)
      const file = selectedFile
      const staged = showsStagedSide
      let previousSignature: string | null = null
      let framesLeft = SELECTION_SWEEP_MAX_FRAMES
      const sweep = () => {
        if (generation !== sweepGeneration.current) {
          return
        }
        if (!diffBodyRef.current) {
          setLineSelection(null)
          return
        }
        const lines = collectSelectedLines(diffBodyRef.current)
        const signature = lines.map((line) => `${line.kind}:${line.lineNumber}`).join('|')
        if (lines.length > 0 && signature === previousSignature) {
          setLineSelection({ file, staged, patchKey, lines })
          return
        }
        framesLeft -= 1
        if (framesLeft <= 0) {
          setLineSelection(lines.length === 0 ? null : { file, staged, patchKey, lines })
          return
        }
        previousSignature = signature
        scheduleFrame(sweep)
      }
      scheduleFrame(sweep)
    },
    [selectedFile, showsStagedSide, patchKey, collectSelectedLines, scheduleFrame]
  )

  const runLineAction = useCallback(async () => {
    if (!selectedFile || !activeLineSelection || patch === undefined) {
      return
    }
    const selections = mapSelectionToHunkSelections(hunks, patch, activeLineSelection.lines)
    if (selections.length === 0) {
      setLineSelection(null)
      return
    }
    const applied = showsStagedSide
      ? await unstageLines(selectedFile, selections)
      : await stageLines(selectedFile, selections)
    if (applied) {
      setLineSelection(null)
    }
  }, [selectedFile, activeLineSelection, patch, hunks, showsStagedSide, stageLines, unstageLines])

  return { activeLineSelection, diffBodyRef, onLineSelectionEnd, runLineAction }
}
