import { diffAcceptRejectHunk } from '@pierre/diffs'
import { FileDiff, Virtualizer } from '@pierre/diffs/react'
import { parseUnifiedDiff } from '@shared/unified-diff'
import { FileDiffIcon } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { useWorkspaceContext } from '@/app/WorkspaceContext'
import { DIFF_UNSAFE_CSS, diffThemeStyle } from '@/features/diff/diff-theme'
import { parsePatch } from '@/features/diff/patch-parse'
import { type AmendDropControls, useDiffGutterActions } from '@/features/diff/useDiffGutterActions'
import { useDiffHunkActions } from '@/features/diff/useDiffHunkActions'
import { useDiffLineSelection } from '@/features/diff/useDiffLineSelection'
import { cn } from '@/lib/utils'
import { useFileDiff, useWorkingTreeStatus } from '@/stores/git'
import { Checkbox } from '../../components/ui/checkbox'
import { EmptyState } from '../../components/ui/empty-state'
import type { SelectedFile } from '../status/StatusPanel'

export type { AmendDropControls } from '@/features/diff/useDiffGutterActions'

interface DiffPanelProps {
  selected: SelectedFile | null
  amendDrop?: AmendDropControls
}

function patchHash(patch: string): string {
  let hash = 2166136261
  for (let index = 0; index < patch.length; index++) {
    hash = Math.imul(hash ^ patch.charCodeAt(index), 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function DiffPanel(props: DiffPanelProps) {
  const {
    status,
    stageFile: stageFileOp,
    unstageFile: unstageFileOp,
    stageHunk: stageHunkOp,
    unstageHunk: unstageHunkOp,
    discardHunk: discardHunkOp,
    stageLines: stageLinesOp,
    unstageLines: unstageLinesOp
  } = useWorkingTreeStatus()
  const { confirm } = useWorkspaceContext()

  const source = props.selected?.source ?? 'worktree'
  const isHeadCommit = source === 'head-commit'
  const isWorktree = source === 'worktree'
  const isConflict = props.selected?.group === 'conflicts'
  const showsStagedSide = props.selected?.group === 'staged'
  const worktreeFile = isWorktree ? (props.selected?.file ?? null) : null
  const headFile = isHeadCommit ? (props.selected?.file ?? null) : null
  const selectedFile = props.selected?.file ?? null

  const isUntracked =
    props.selected !== null &&
    isWorktree &&
    (status?.not_added.includes(props.selected.file) ?? false)

  const worktreeQuery = useFileDiff(worktreeFile, showsStagedSide)
  const rangeQuery = useFileDiff(headFile, false, props.selected?.range)
  const activeQuery = isHeadCommit ? rangeQuery : worktreeQuery

  const data = props.selected ? (activeQuery.data ?? null) : null
  const patch = data?.patch
  const hunks = useMemo(() => (patch === undefined ? [] : parseUnifiedDiff(patch).hunks), [patch])
  const isBinary = Boolean(data?.binary)

  const { activePending, requestHunkAction } = useDiffHunkActions({
    selectedFile,
    showsStagedSide,
    hunks,
    dataUpdatedAt: activeQuery.dataUpdatedAt,
    stageHunk: stageHunkOp,
    unstageHunk: unstageHunkOp,
    discardHunk: discardHunkOp,
    confirm
  })

  const currentPatchKey = useMemo(() => (patch === undefined ? null : patchHash(patch)), [patch])
  const { activeLineSelection, diffBodyRef, onLineSelectionEnd, runLineAction } =
    useDiffLineSelection({
      selectedFile,
      showsStagedSide,
      patch,
      patchKey: currentPatchKey,
      hunks,
      stageLines: stageLinesOp,
      unstageLines: unstageLinesOp
    })

  const amendDrop = isHeadCommit ? props.amendDrop : undefined
  const hunkActionsEnabled =
    isWorktree && !isConflict && !isBinary && (showsStagedSide || !isUntracked)
  const fileStagingEnabled = isWorktree && !isConflict && !isBinary && selectedFile !== null

  const parsed = useMemo(() => {
    if (patch === undefined || selectedFile === null) {
      return null
    }
    return parsePatch(patch, `${selectedFile}:${showsStagedSide}:${patchHash(patch)}`)
  }, [patch, selectedFile, showsStagedSide])

  const parsedFiles = parsed?.kind === 'parsed' ? parsed.files : []
  const displayFiles = useMemo(() => {
    if (!activePending) {
      return parsedFiles
    }
    const hunkIndex = hunks.findIndex((hunk) => hunk.header === activePending.header)
    if (hunkIndex === -1) {
      return parsedFiles
    }
    return parsedFiles.map((file, fileIndex) =>
      fileIndex === 0 && hunkIndex < file.hunks.length
        ? diffAcceptRejectHunk(file, hunkIndex, activePending.resolution)
        : file
    )
  }, [parsedFiles, activePending, hunks])

  const { gutterEnabled, onLineEnter, renderGutterUtility, hunkAnnotations, renderAnnotation } =
    useDiffGutterActions({
      hunks,
      amendDrop,
      hunkActionsEnabled,
      activeLineCount: activeLineSelection?.lines.length ?? null,
      showsStagedSide,
      runLineAction,
      requestHunkAction
    })

  const options = useMemo(
    () => ({
      diffStyle: 'unified' as const,
      themeType: 'dark' as const,
      preferredHighlighter: 'shiki-js' as const,
      lineDiffType: 'word-alt' as const,
      maxLineDiffLength: 1000,
      diffIndicators: 'bars' as const,
      unsafeCSS: DIFF_UNSAFE_CSS,
      disableFileHeader: true,
      enableGutterUtility: gutterEnabled,
      enableLineSelection: hunkActionsEnabled,
      onLineEnter,
      onLineSelectionEnd
    }),
    [gutterEnabled, hunkActionsEnabled, onLineEnter, onLineSelectionEnd]
  )

  const totals = useMemo(() => {
    let adds = 0
    let dels = 0
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'add') {
          adds++
        } else if (line.kind === 'del') {
          dels++
        }
      }
    }
    return { adds, dels }
  }, [hunks])

  const hasAnyHunks = hunks.length > 0
  const hasParsedContent = displayFiles.some((file) => file.hunks.length > 0)

  const toggleFileStaged = () => {
    if (!selectedFile) {
      return
    }
    if (showsStagedSide) {
      void unstageFileOp(selectedFile, props.selected?.renameSource)
      return
    }
    void stageFileOp(selectedFile)
  }

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      {props.selected ? (
        <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 border-b py-1.5 pl-3.5 pr-2">
          {hasAnyHunks && !isBinary && isHeadCommit && props.amendDrop ? (
            <Checkbox
              checked={props.amendDrop.dropState === 'kept'}
              indeterminate={props.amendDrop.dropState === 'partial'}
              aria-label={
                props.amendDrop.dropState === 'kept'
                  ? `Drop ${props.selected.file} from last commit`
                  : `Keep ${props.selected.file} in last commit`
              }
              onChange={props.amendDrop.onToggleFile}
            />
          ) : null}
          <span className="min-w-0 truncate text-sm font-semibold" title={props.selected.file}>
            {props.selected.file}
          </span>
          {!isBinary && (totals.adds > 0 || totals.dels > 0) ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
              <span className="text-add">+{totals.adds}</span>
              <span className="text-del">−{totals.dels}</span>
            </span>
          ) : null}
          <div className="flex-1" />
          {fileStagingEnabled ? (
            <button
              type="button"
              onClick={toggleFileStaged}
              className="h-7 shrink-0 rounded-[var(--r-sm)] border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              {showsStagedSide ? 'Unstage file' : 'Stage file'}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="border-b" />
      )}

      {!props.selected ? (
        <div className="min-h-0 overflow-auto p-2" data-testid="diff-body">
          <EmptyState
            size="sm"
            icon={FileDiffIcon}
            title="No file selected"
            description="Select a file on the left to review its changes."
          />
        </div>
      ) : activeQuery.isError ? (
        <StateNotice className="text-destructive">
          Failed to load diff
          {activeQuery.error instanceof Error ? `: ${activeQuery.error.message}` : '.'}
        </StateNotice>
      ) : isBinary ? (
        <StateNotice>Binary file — no preview available.</StateNotice>
      ) : activeQuery.isPending || parsed === null ? (
        <StateNotice>Loading diff…</StateNotice>
      ) : parsed.kind === 'raw' ? (
        <div className="min-h-0 overflow-auto p-2" data-testid="diff-body">
          <pre
            className="whitespace-pre px-2 py-1 font-mono text-[13px] leading-[20px]"
            data-testid="diff-raw-patch"
          >
            {parsed.patch}
          </pre>
        </div>
      ) : !hasAnyHunks || !hasParsedContent ? (
        <StateNotice>No changes to show.</StateNotice>
      ) : (
        <div className="min-h-0 overflow-hidden" data-testid="diff-body" ref={diffBodyRef}>
          <Virtualizer
            className="scroll-host h-full min-h-0 overflow-y-auto"
            style={diffThemeStyle()}
          >
            {displayFiles.map((file) => (
              <FileDiff
                key={file.name}
                fileDiff={file}
                options={options}
                renderGutterUtility={gutterEnabled ? renderGutterUtility : undefined}
                lineAnnotations={hunkAnnotations}
                renderAnnotation={hunkAnnotations ? renderAnnotation : undefined}
              />
            ))}
          </Virtualizer>
        </div>
      )}
    </section>
  )
}

function StateNotice(props: { className?: string; children: ReactNode }) {
  return (
    <div className="min-h-0 overflow-auto p-2" data-testid="diff-body">
      <div className={cn('px-2 py-4 text-sm text-muted-foreground', props.className)}>
        {props.children}
      </div>
    </div>
  )
}
