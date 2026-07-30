import type { DiffHunk, DiffLine } from '@shared/schemas/git'
import { useQuery } from '@tanstack/react-query'
import { FileDiffIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { HeadDropState } from '@/features/commit/amend-drops'
import {
  highlightHunk,
  hunkHighlightKey,
  type LineTokens,
  languageForFile
} from '@/features/diff/diff-highlight'
import { type RepoQueryKeys, repoQueryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { useCommitFileDiff, useFileDiff, useRepoSession, useWorkingTreeStatus } from '@/stores/git'
import { Checkbox } from '../../components/ui/checkbox'
import { EmptyState } from '../../components/ui/empty-state'
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

interface PendingHunk {
  file: string
  staged: boolean
  header: string
  hunk: DiffHunk
  position: number
}

export function DiffPanel(props: DiffPanelProps) {
  const { repoPath } = useRepoSession()
  const { status, stageHunk: stageHunkOp, unstageHunk: unstageHunkOp } = useWorkingTreeStatus()
  const queryKeys = repoQueryKeys(repoPath, { idle: 'diff-panel' })

  const source = props.selected?.source ?? 'worktree'
  const isHeadCommit = source === 'head-commit'
  const isCommit = source === 'commit'
  const isWorktree = source === 'worktree'
  const isConflict = props.selected?.group === 'conflicts'
  const showsStagedSide = props.selected?.group === 'staged'
  const worktreeFile = isWorktree ? (props.selected?.file ?? null) : null
  const headFile = isHeadCommit ? (props.selected?.file ?? null) : null
  const commitFile = isCommit ? (props.selected?.file ?? null) : null

  const isUntracked =
    props.selected !== null &&
    isWorktree &&
    (status?.not_added.includes(props.selected.file) ?? false)

  const worktreeQuery = useFileDiff(worktreeFile, showsStagedSide)
  const rangeQuery = useFileDiff(headFile, false, props.selected?.range)
  const commitQuery = useCommitFileDiff(
    isCommit ? (props.selected?.commit ?? null) : null,
    commitFile,
    props.selected?.renameSource
  )
  const [pendingHunk, setPendingHunk] = useState<PendingHunk | null>(null)

  const activeQuery = isCommit ? commitQuery : isHeadCommit ? rangeQuery : worktreeQuery
  const diff = props.selected ? (activeQuery.data ?? null) : null
  const isBinary = Boolean(diff?.binary)
  const hasError = activeQuery.isError
  const errorMessage = activeQuery.error?.message
  const isLoading = activeQuery.isPending

  const activePending =
    pendingHunk &&
    pendingHunk.file === props.selected?.file &&
    pendingHunk.staged === showsStagedSide
      ? pendingHunk
      : null

  const actualHunks = diff?.hunks ?? []
  const hunks = useMemo<DiffHunk[]>(() => {
    if (!activePending || actualHunks.some((hunk) => hunk.header === activePending.header)) {
      return actualHunks
    }
    const withPending = [...actualHunks]
    withPending.splice(Math.min(activePending.position, withPending.length), 0, activePending.hunk)
    return withPending
  }, [actualHunks, activePending])

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

  const clearPendingHunk = (pending: PendingHunk) => {
    setPendingHunk((current) => (current === pending ? null : current))
  }

  const toggleHunk = async (hunk: DiffHunk, position: number) => {
    const file = props.selected?.file
    if (!file) {
      return
    }
    const isLastOnSide = actualHunks.length === 1
    const pending: PendingHunk = {
      file,
      staged: showsStagedSide,
      header: hunk.header,
      hunk,
      position
    }
    setPendingHunk(pending)
    try {
      if (showsStagedSide) {
        await unstageHunkOp(file, hunk.header, { fullyUnstagesFile: isLastOnSide })
      } else {
        await stageHunkOp(file, hunk.header, { fullyStagesFile: isLastOnSide })
      }
    } catch {
    } finally {
      clearPendingHunk(pending)
    }
  }

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      {props.selected ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-2.5 border-b pl-3.5 pr-2',
            isCommit ? 'min-h-8 py-1' : 'min-h-[46px] py-1.5'
          )}
        >
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
          {totals.adds > 0 || totals.dels > 0 ? (
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

      <div className="min-h-0 overflow-auto p-2" data-testid="diff-body">
        {!props.selected ? (
          <EmptyState
            size="sm"
            icon={FileDiffIcon}
            title="No file selected"
            description="Select a file on the left to review its changes."
          />
        ) : hasError ? (
          <DiffError message={errorMessage} />
        ) : isBinary ? (
          <div className="px-2 py-4 text-sm text-muted-foreground">
            Binary file — no preview available.
          </div>
        ) : isLoading ? (
          <div className="px-2 py-4 text-sm text-muted-foreground">Loading diff…</div>
        ) : hasAnyHunks ? (
          hunks.map((hunk, position) => {
            const pending = activePending?.header === hunk.header
            return (
              <HunkCard
                key={`${hunkHighlightKey(hunk)}:${hunk.oldStart}`}
                hunk={hunk}
                filePath={props.selected?.file ?? ''}
                queryKeys={queryKeys}
                staged={pending ? !showsStagedSide : showsStagedSide}
                pending={pending}
                hunkActionsEnabled={isWorktree && !isConflict && (showsStagedSide || !isUntracked)}
                amend={
                  isHeadCommit && props.amendDrop
                    ? {
                        dropped: props.amendDrop.isHunkDropped(hunk.header),
                        onToggleDrop: () =>
                          props.amendDrop?.onToggleHunk(
                            hunk.header,
                            hunks.map((entry) => entry.header)
                          )
                      }
                    : undefined
                }
                onToggleHunk={() => void toggleHunk(hunk, position)}
              />
            )
          })
        ) : (
          <div className="px-2 py-4 text-sm text-muted-foreground">No changes to show.</div>
        )}
      </div>
    </section>
  )
}

function DiffError(props: { message?: string }) {
  return (
    <div className="px-2 py-4 text-sm text-destructive">
      Failed to load diff{props.message ? `: ${props.message}` : '.'}
    </div>
  )
}

interface HunkCardProps {
  hunk: DiffHunk
  filePath: string
  queryKeys: RepoQueryKeys
  staged: boolean
  pending: boolean
  hunkActionsEnabled: boolean
  amend?: { dropped: boolean; onToggleDrop: () => void }
  onToggleHunk: () => void
}

function HunkCard(props: HunkCardProps) {
  const toggle = () => {
    if (props.pending) {
      return
    }
    props.onToggleHunk()
  }

  const highlightQuery = useQuery<Array<LineTokens | null> | null>({
    queryKey: props.queryKeys.hunkHighlight(props.filePath, hunkHighlightKey(props.hunk)),
    enabled: languageForFile(props.filePath) !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: () => highlightHunk(props.filePath, props.hunk.lines)
  })

  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border" data-testid="diff-hunk">
      <div className="flex h-8 items-center gap-2.5 border-b bg-card-2 px-2.5">
        {props.amend ? (
          <Checkbox
            checked={!props.amend.dropped}
            onChange={props.amend.onToggleDrop}
            aria-label={props.amend.dropped ? 'Keep hunk' : 'Drop hunk'}
          />
        ) : props.hunkActionsEnabled ? (
          <Checkbox
            checked={props.staged}
            disabled={props.pending}
            onChange={toggle}
            aria-label={props.staged ? 'Unstage hunk' : 'Stage hunk'}
          />
        ) : null}
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {props.hunk.header}
        </span>
      </div>
      {props.hunk.lines.map((line, index) => (
        <DiffLineRow
          key={diffLineKey(line)}
          line={line}
          tokens={highlightQuery.data?.[index] ?? null}
        />
      ))}
    </div>
  )
}

function diffLineKey(line: DiffLine) {
  return `${line.kind}:${line.oldLine ?? ''}:${line.newLine ?? ''}:${line.text}`
}

function tokenKey(token: LineTokens[number], index: number) {
  return `${token.content}:${token.color}:${index}`
}

function DiffLineRow(props: { line: DiffLine; tokens: LineTokens | null }) {
  const line = props.line
  if (line.kind === 'meta') {
    return (
      <div className="px-2 py-0.5 font-mono text-[14px] text-muted-foreground">{line.text}</div>
    )
  }
  const lineNumberClass = cn(
    'select-none pr-2.5 text-right tabular-nums',
    line.kind === 'add' && 'text-add',
    line.kind === 'del' && 'text-del',
    line.kind === 'context' && 'text-muted-foreground/60'
  )
  return (
    <div className="grid grid-cols-[5px_44px_44px_minmax(0,1fr)] items-baseline whitespace-pre-wrap break-words font-mono text-[14px] leading-[24px]">
      <span
        className={cn(
          'self-stretch',
          line.kind === 'add' && 'bg-add',
          line.kind === 'del' && 'bg-del/80'
        )}
      />
      <span className={lineNumberClass}>{line.oldLine ?? ''}</span>
      <span className={lineNumberClass}>{line.newLine ?? ''}</span>
      <span>
        {props.tokens
          ? props.tokens.map((token, index) => (
              <span key={tokenKey(token, index)} style={{ color: token.color }}>
                {token.content}
              </span>
            ))
          : line.text}
      </span>
    </div>
  )
}
