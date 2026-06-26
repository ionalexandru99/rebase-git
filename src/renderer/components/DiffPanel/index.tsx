import type { DiffHunk, DiffLine, FileDiff } from '@shared/schemas/git'
import { useQuery } from '@tanstack/react-query'
import { FileDiffIcon } from 'lucide-react'
import { type CSSProperties, useMemo, useState } from 'react'
import {
  highlightHunk,
  hunkHighlightKey,
  type LineTokens,
  languageForFile
} from '@/lib/diff-highlight'
import { type HunkEntry, type PendingHunk, remapHunk } from '@/lib/diff-merge'
import { type RepoQueryKeys, repoQueryKeys } from '@/lib/query-keys'
import { rpcGetDiff } from '@/lib/rpc-client'
import { cn } from '@/lib/utils'
import { type GitStore, useRepoSession } from '@/stores/git'
import type { SelectedFile } from '../StatusPanel'
import { Checkbox } from '../ui/checkbox'
import { EmptyState } from '../ui/empty-state'

interface DiffPanelProps {
  git: GitStore
  selected: SelectedFile | null
}

export function DiffPanel(props: DiffPanelProps) {
  const git = props.git
  const { repoPath } = useRepoSession()
  const queryKeys = repoQueryKeys(repoPath, { idle: 'diff-panel' })

  const isUntracked =
    props.selected !== null && (git.state.status?.not_added.includes(props.selected.file) ?? false)

  const buildDiffQueryOptions = (staged: boolean) => {
    const selected = props.selected
    return {
      queryKey: selected ? queryKeys.diff(selected.file, staged) : queryKeys.diff('none', staged),
      enabled: Boolean(repoPath && selected),
      queryFn: async (): Promise<FileDiff> => {
        if (!repoPath || !selected) {
          throw new Error('No file selected')
        }
        const response = await rpcGetDiff(repoPath, selected.file, staged)
        if (response._tag === 'Ok') {
          return response.diff
        }
        if (response._tag === 'GitError') {
          throw new Error(response.message)
        }
        throw new Error('Repository not open')
      }
    }
  }

  const unstagedQuery = useQuery(buildDiffQueryOptions(false))
  const stagedQuery = useQuery(buildDiffQueryOptions(true))
  const [pendingHunk, setPendingHunk] = useState<PendingHunk | null>(null)

  const unstagedDiff = props.selected ? (unstagedQuery.data ?? null) : null
  const stagedDiff = props.selected ? (stagedQuery.data ?? null) : null

  const isBinary = Boolean(unstagedDiff?.binary || stagedDiff?.binary)
  const hasError = unstagedQuery.isError || stagedQuery.isError
  const errorMessage = unstagedQuery.error?.message ?? stagedQuery.error?.message

  const activePending =
    pendingHunk && pendingHunk.file === props.selected?.file ? pendingHunk : null

  // Both diffs share the index as a coordinate system: the staged diff's "new" side and
  // the unstaged diff's "old" side are the index. Sorting on those keeps document order,
  // and remapping the index side to HEAD/worktree coordinates keeps the displayed line
  // numbers stable when a hunk moves between staged and unstaged.
  const actualMergedHunks = useMemo<HunkEntry[]>(() => {
    const selected = props.selected
    const staged = selected ? (stagedQuery.data?.hunks ?? []) : []
    const unstaged = selected ? (unstagedQuery.data?.hunks ?? []) : []
    const headShiftAt = (indexLine: number) =>
      staged.reduce(
        (shift, hunk) =>
          hunk.newStart < indexLine ? shift + (hunk.oldCount - hunk.newCount) : shift,
        0
      )
    const worktreeShiftAt = (indexLine: number) =>
      unstaged.reduce(
        (shift, hunk) =>
          hunk.oldStart < indexLine ? shift + (hunk.newCount - hunk.oldCount) : shift,
        0
      )
    const entries: HunkEntry[] = [
      ...staged.map((hunk) => ({
        hunk,
        display: remapHunk(hunk, 0, worktreeShiftAt(hunk.newStart)),
        staged: true,
        indexStart: hunk.newStart
      })),
      ...unstaged.map((hunk) => ({
        hunk,
        display: remapHunk(hunk, headShiftAt(hunk.oldStart), 0),
        staged: false,
        indexStart: hunk.oldStart
      }))
    ]
    return entries.sort((left, right) => left.indexStart - right.indexStart)
  }, [props.selected, stagedQuery.data, unstagedQuery.data])

  const mergedHunks = useMemo<HunkEntry[]>(() => {
    if (!activePending) {
      return actualMergedHunks
    }
    const targetStaged = activePending.op === 'stage'
    const entries = actualMergedHunks.filter(
      (entry) => entry.staged === targetStaged || entry.hunk.header !== activePending.opHeader
    )
    const hasTarget = entries.some(
      (entry) =>
        entry.staged === targetStaged &&
        (entry.hunk.header === activePending.opHeader ||
          hunkHighlightKey(entry.hunk) === activePending.key)
    )
    if (!hasTarget) {
      entries.push({
        hunk: activePending.hunk,
        display: activePending.display,
        staged: targetStaged,
        indexStart: activePending.indexStart
      })
    }
    return entries.sort((left, right) => left.indexStart - right.indexStart)
  }, [actualMergedHunks, activePending])

  const totals = useMemo(() => {
    let adds = 0
    let dels = 0
    for (const entry of mergedHunks) {
      const hunk = entry.display
      for (const line of hunk.lines) {
        if (line.kind === 'add') {
          adds++
        } else if (line.kind === 'del') {
          dels++
        }
      }
    }
    return { adds, dels }
  }, [mergedHunks])

  const hasAnyHunks = mergedHunks.length > 0
  const stagedEntryCount = mergedHunks.filter((entry) => entry.staged).length
  const unstagedEntryCount = mergedHunks.filter((entry) => !entry.staged).length

  const fileStageState =
    stagedEntryCount === 0 ? 'unstaged' : unstagedEntryCount > 0 ? 'partial' : 'staged'

  const clearPendingHunk = (pending: PendingHunk) => {
    setPendingHunk((current) => (current === pending ? null : current))
  }

  const stageHunk = async (entry: HunkEntry) => {
    const file = props.selected?.file
    if (!file) {
      return
    }
    const fullyStagesFile = unstagedEntryCount === 1
    const pending: PendingHunk = {
      file,
      op: 'stage',
      opHeader: entry.hunk.header,
      hunk: entry.hunk,
      display: entry.display,
      staged: entry.staged,
      indexStart: entry.indexStart,
      key: hunkHighlightKey(entry.hunk)
    }
    setPendingHunk(pending)
    try {
      await git.stageHunk(file, entry.hunk.header, { fullyStagesFile })
    } finally {
      clearPendingHunk(pending)
    }
  }

  const unstageHunk = async (entry: HunkEntry) => {
    const file = props.selected?.file
    if (!file) {
      return
    }
    const fullyUnstagesFile = stagedEntryCount === 1
    const pending: PendingHunk = {
      file,
      op: 'unstage',
      opHeader: entry.hunk.header,
      hunk: entry.hunk,
      display: entry.display,
      staged: entry.staged,
      indexStart: entry.indexStart,
      key: hunkHighlightKey(entry.hunk)
    }
    setPendingHunk(pending)
    try {
      await git.unstageHunk(file, entry.hunk.header, { fullyUnstagesFile })
    } finally {
      clearPendingHunk(pending)
    }
  }

  const isPendingEntry = (entry: HunkEntry) => {
    if (!activePending) {
      return false
    }
    return (
      entry.hunk.header === activePending.opHeader ||
      hunkHighlightKey(entry.hunk) === activePending.key
    )
  }

  const toggleFileStaged = () => {
    const file = props.selected?.file
    if (!file) {
      return
    }
    if (fileStageState === 'staged') {
      void git.unstageFile(file)
    } else {
      void git.stageFile(file)
    }
  }

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      {props.selected ? (
        <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 border-b py-1.5 pl-3.5 pr-2">
          {hasAnyHunks && !isBinary ? (
            <Checkbox
              checked={fileStageState === 'staged'}
              indeterminate={fileStageState === 'partial'}
              aria-label={
                fileStageState === 'staged'
                  ? `Unstage ${props.selected.file}`
                  : `Stage ${props.selected.file}`
              }
              onChange={toggleFileStaged}
            />
          ) : null}
          <span className="min-w-0 truncate text-sm font-semibold" title={props.selected.file}>
            {props.selected.file}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
            <span className="text-add">+{totals.adds}</span>
            <span className="text-del">−{totals.dels}</span>
          </span>
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
        ) : hasAnyHunks ? (
          mergedHunks.map((entry) => (
            <HunkCard
              key={`${entry.staged ? 'staged' : 'unstaged'}:${hunkHighlightKey(entry.hunk)}:${entry.indexStart}`}
              hunk={entry.display}
              filePath={props.selected?.file ?? ''}
              queryKeys={queryKeys}
              staged={entry.staged}
              pending={isPendingEntry(entry)}
              hunkActionsEnabled={entry.staged || !isUntracked}
              onStageHunk={() => void stageHunk(entry)}
              onUnstageHunk={() => void unstageHunk(entry)}
            />
          ))
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
  onStageHunk: () => void
  onUnstageHunk: () => void
}

function HunkCard(props: HunkCardProps) {
  const toggle = () => {
    if (props.pending) {
      return
    }
    if (props.staged) {
      props.onUnstageHunk()
    } else {
      props.onStageHunk()
    }
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
        {props.hunkActionsEnabled ? (
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
  return `${token.content}:${token.lightColor}:${token.darkColor}:${index}`
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
              <span
                key={tokenKey(token, index)}
                className="text-(--shiki-light) dark:text-(--shiki-dark)"
                style={
                  {
                    '--shiki-light': token.lightColor,
                    '--shiki-dark': token.darkColor
                  } as CSSProperties
                }
              >
                {token.content}
              </span>
            ))
          : line.text}
      </span>
    </div>
  )
}
