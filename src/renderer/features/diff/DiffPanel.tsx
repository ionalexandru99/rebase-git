import { diffAcceptRejectHunk } from '@pierre/diffs'
import { FileDiff, Virtualizer } from '@pierre/diffs/react'
import type { DiffHunk } from '@shared/schemas/git'
import {
  FileDiffIcon,
  type LucideIcon,
  MinusIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon
} from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useWorkspaceContext } from '@/app/WorkspaceContext'
import { DIFF_UNSAFE_CSS, diffThemeStyle } from '@/features/diff/diff-theme'
import { type DiffSide, hunkAtLine } from '@/features/diff/hunk-at-line'
import { parsePatch } from '@/features/diff/patch-parse'
import { cn } from '@/lib/utils'
import { useFileDiff, useWorkingTreeStatus } from '@/stores/git'
import { Checkbox } from '../../components/ui/checkbox'
import { EmptyState } from '../../components/ui/empty-state'
import type { HeadDropState } from '../commit/amend-drops'
import type { SelectedFile } from '../status/StatusPanel'

export interface AmendDropControls {
  dropState: HeadDropState
  isHunkDropped: (hunkHeader: string) => boolean
  onToggleFile: () => void
  onToggleHunk: (hunkHeader: string, allHeaders: string[]) => void
}

interface DiffPanelProps {
  selected: SelectedFile | null
  amendDrop?: AmendDropControls
}

interface HoveredLine {
  lineNumber: number
  side: DiffSide
}

interface PendingHunkRemoval {
  file: string
  staged: boolean
  header: string
  resolution: 'accept' | 'reject'
  dataUpdatedAt: number
}

type HunkAction = 'stage' | 'unstage' | 'discard'

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
    stageHunk: stageHunkOp,
    unstageHunk: unstageHunkOp,
    discardHunk: discardHunkOp
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
  const diff = data?.diff ?? null
  const patch = data?.patch
  const hunks = useMemo(() => diff?.hunks ?? [], [diff])
  const isBinary = Boolean(diff?.binary)

  const [pending, setPending] = useState<PendingHunkRemoval | null>(null)
  const [hoveredLine, setHoveredLine] = useState<HoveredLine | null>(null)

  const activePending =
    pending &&
    pending.file === selectedFile &&
    pending.staged === showsStagedSide &&
    pending.dataUpdatedAt === activeQuery.dataUpdatedAt
      ? pending
      : null

  const amendDrop = isHeadCommit ? props.amendDrop : undefined
  const hunkActionsEnabled =
    isWorktree && !isConflict && !isBinary && (showsStagedSide || !isUntracked)
  const gutterEnabled = Boolean(hunkActionsEnabled || amendDrop)

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

  const runHunkAction = useCallback(
    async (action: HunkAction, hunk: DiffHunk) => {
      if (!selectedFile) {
        return
      }
      const isLastOnSide = hunks.length === 1
      setPending({
        file: selectedFile,
        staged: showsStagedSide,
        header: hunk.header,
        resolution: action === 'stage' ? 'accept' : 'reject',
        dataUpdatedAt: activeQuery.dataUpdatedAt
      })
      try {
        if (action === 'stage') {
          await stageHunkOp(selectedFile, hunk.header, { fullyStagesFile: isLastOnSide })
        } else if (action === 'unstage') {
          await unstageHunkOp(selectedFile, hunk.header, { fullyUnstagesFile: isLastOnSide })
        } else {
          await discardHunkOp(selectedFile, hunk.header)
        }
      } catch {
        setPending(null)
      }
    },
    [
      selectedFile,
      hunks,
      showsStagedSide,
      activeQuery.dataUpdatedAt,
      stageHunkOp,
      unstageHunkOp,
      discardHunkOp
    ]
  )

  const requestHunkAction = useCallback(
    (action: HunkAction, hunk: DiffHunk) => {
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

  const toggleHunkDrop = useCallback(
    (hunk: DiffHunk) => {
      amendDrop?.onToggleHunk(
        hunk.header,
        hunks.map((entry) => entry.header)
      )
    },
    [amendDrop, hunks]
  )

  const hoveredHunk = hoveredLine
    ? hunkAtLine(hunks, hoveredLine.side, hoveredLine.lineNumber)
    : null
  const hoveredDropped = hoveredHunk
    ? (amendDrop?.isHunkDropped(hoveredHunk.header) ?? false)
    : false

  const renderGutterUtility = useCallback(
    (getHoveredLine: () => HoveredLine | undefined): ReactNode => {
      const actOnHovered = (run: (hunk: DiffHunk) => void) => () => {
        const hovered = getHoveredLine()
        if (!hovered) {
          return
        }
        const hunk = hunkAtLine(hunks, hovered.side, hovered.lineNumber)
        if (hunk) {
          run(hunk)
        }
      }
      if (amendDrop) {
        return (
          <GutterActionRow>
            <GutterActionButton
              label={hoveredDropped ? 'Keep hunk' : 'Drop hunk'}
              icon={hoveredDropped ? Undo2Icon : MinusIcon}
              onClick={actOnHovered(toggleHunkDrop)}
            />
          </GutterActionRow>
        )
      }
      if (!hunkActionsEnabled) {
        return null
      }
      return (
        <GutterActionRow>
          {showsStagedSide ? (
            <GutterActionButton
              label="Unstage hunk"
              icon={MinusIcon}
              onClick={actOnHovered((hunk) => requestHunkAction('unstage', hunk))}
            />
          ) : (
            <>
              <GutterActionButton
                label="Stage hunk"
                icon={PlusIcon}
                onClick={actOnHovered((hunk) => requestHunkAction('stage', hunk))}
              />
              <GutterActionButton
                label="Discard hunk"
                icon={Trash2Icon}
                destructive={true}
                onClick={actOnHovered((hunk) => requestHunkAction('discard', hunk))}
              />
            </>
          )}
        </GutterActionRow>
      )
    },
    [
      amendDrop,
      hoveredDropped,
      toggleHunkDrop,
      hunkActionsEnabled,
      showsStagedSide,
      requestHunkAction,
      hunks
    ]
  )

  const onLineEnter = useCallback((event: { lineNumber: number; annotationSide: DiffSide }) => {
    setHoveredLine({ lineNumber: event.lineNumber, side: event.annotationSide })
  }, [])

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
      onLineEnter
    }),
    [gutterEnabled, onLineEnter]
  )

  const hunkAnnotations = useMemo(() => {
    if (!gutterEnabled || hunks.length === 0) {
      return undefined
    }
    return hunks.map((hunk) => ({
      side: (hunk.newCount > 0 ? 'additions' : 'deletions') as DiffSide,
      lineNumber: hunk.newCount > 0 ? hunk.newStart : hunk.oldStart,
      metadata: { header: hunk.header }
    }))
  }, [gutterEnabled, hunks])

  const renderAnnotation = useCallback(
    (annotation: { metadata: { header: string } }): ReactNode => {
      const hunkIndex = hunks.findIndex((entry) => entry.header === annotation.metadata.header)
      if (hunkIndex === -1) {
        return null
      }
      const hunk = hunks[hunkIndex]
      const position = `${hunkIndex + 1} of ${hunks.length}`
      if (amendDrop) {
        if (amendDrop.isHunkDropped(hunk.header)) {
          return (
            <div className="flex items-center gap-2 border-b border-t bg-card-2 px-2.5 py-1 text-xs text-muted-foreground">
              <span>Dropped from last commit</span>
              <GutterActionButton
                label={`Keep hunk ${position}`}
                icon={Undo2Icon}
                onClick={() => toggleHunkDrop(hunk)}
              />
            </div>
          )
        }
        return (
          <FocusRevealRow>
            <GutterActionButton
              label={`Drop hunk ${position}`}
              icon={MinusIcon}
              onClick={() => toggleHunkDrop(hunk)}
            />
          </FocusRevealRow>
        )
      }
      return (
        <FocusRevealRow>
          {showsStagedSide ? (
            <GutterActionButton
              label={`Unstage hunk ${position}`}
              icon={MinusIcon}
              onClick={() => requestHunkAction('unstage', hunk)}
            />
          ) : (
            <>
              <GutterActionButton
                label={`Stage hunk ${position}`}
                icon={PlusIcon}
                onClick={() => requestHunkAction('stage', hunk)}
              />
              <GutterActionButton
                label={`Discard hunk ${position}`}
                icon={Trash2Icon}
                destructive={true}
                onClick={() => requestHunkAction('discard', hunk)}
              />
            </>
          )}
        </FocusRevealRow>
      )
    },
    [hunks, amendDrop, toggleHunkDrop, showsStagedSide, requestHunkAction]
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
        <div className="min-h-0 overflow-hidden" data-testid="diff-body">
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

function FocusRevealRow(props: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-2.5 py-0.5 not-focus-within:sr-only">
      {props.children}
    </div>
  )
}

function GutterActionRow(props: { children: ReactNode }) {
  return (
    <div className="absolute left-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
      {props.children}
    </div>
  )
}

function GutterActionButton(props: {
  label: string
  icon: LucideIcon
  destructive?: boolean
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={cn(
        'grid size-[22px] place-content-center rounded-[var(--r-sm)] border bg-card shadow-sm transition-colors',
        props.destructive
          ? 'text-destructive hover:bg-destructive hover:text-white'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
}
