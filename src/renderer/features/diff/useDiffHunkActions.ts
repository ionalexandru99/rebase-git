import type { ParsedHunk } from '@shared/unified-diff'
import { useCallback, useState } from 'react'
import type { ConfirmRequest } from '@/components/ui/prompt-dialog'

export type HunkAction = 'stage' | 'unstage' | 'discard'

interface PendingHunkRemoval {
  file: string
  staged: boolean
  header: string
  resolution: 'accept' | 'reject'
  dataUpdatedAt: number
}

type HunkMutation = (
  file: string,
  hunkHeader: string,
  options: { fullyStagesFile?: boolean; fullyUnstagesFile?: boolean }
) => Promise<unknown>

interface DiffHunkActionOptions {
  selectedFile: string | null
  showsStagedSide: boolean
  hunks: ParsedHunk[]
  dataUpdatedAt: number
  stageHunk: HunkMutation
  unstageHunk: HunkMutation
  discardHunk: (file: string, hunkHeader: string) => Promise<unknown>
  confirm: (request: ConfirmRequest) => void
}

export function useDiffHunkActions(options: DiffHunkActionOptions) {
  const {
    selectedFile,
    showsStagedSide,
    hunks,
    dataUpdatedAt,
    stageHunk,
    unstageHunk,
    discardHunk,
    confirm
  } = options
  const [pending, setPending] = useState<PendingHunkRemoval | null>(null)

  const activePending =
    pending &&
    pending.file === selectedFile &&
    pending.staged === showsStagedSide &&
    pending.dataUpdatedAt === dataUpdatedAt
      ? pending
      : null

  const runHunkAction = useCallback(
    async (action: HunkAction, hunk: ParsedHunk) => {
      if (!selectedFile) {
        return
      }
      const isLastOnSide = hunks.length === 1
      setPending({
        file: selectedFile,
        staged: showsStagedSide,
        header: hunk.header,
        resolution: action === 'stage' ? 'accept' : 'reject',
        dataUpdatedAt
      })
      try {
        if (action === 'stage') {
          await stageHunk(selectedFile, hunk.header, { fullyStagesFile: isLastOnSide })
        } else if (action === 'unstage') {
          await unstageHunk(selectedFile, hunk.header, {
            fullyUnstagesFile: isLastOnSide
          })
        } else {
          await discardHunk(selectedFile, hunk.header)
        }
      } catch {
        setPending(null)
      }
    },
    [selectedFile, hunks, showsStagedSide, dataUpdatedAt, stageHunk, unstageHunk, discardHunk]
  )

  const requestHunkAction = useCallback(
    (action: HunkAction, hunk: ParsedHunk) => {
      if (action === 'discard') {
        confirm({
          title: `Discard hunk in ${selectedFile}?`,
          message: 'Local edits in this hunk are lost.',
          confirmText: 'Discard',
          destructive: true,
          onConfirm: () => void runHunkAction('discard', hunk)
        })
        return
      }
      void runHunkAction(action, hunk)
    },
    [confirm, selectedFile, runHunkAction]
  )

  return { activePending, requestHunkAction }
}
