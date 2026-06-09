import type { DiffHunk, DiffLine, FileDiff } from '@shared/schemas/git'
import { GetDiffResponseSchema } from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import { FileDiffIcon } from 'lucide-react'
import {
  highlightHunk,
  hunkHighlightKey,
  type LineTokens,
  languageForFile
} from '@/lib/diff-highlight'
import { createMemo, For, Show } from '@/lib/react-compat'
import { createQuery } from '@/lib/react-query-compat'
import { sidecarFetch } from '@/lib/sidecar-fetch'
import { cn } from '@/lib/utils'
import type { GitStore } from '@/stores/git'
import type { SelectedFile } from '../StatusPanel'
import { Checkbox } from '../ui/checkbox'
import { EmptyState } from '../ui/empty-state'

interface DiffPanelProps {
  git: GitStore
  selected: SelectedFile | null
}

export function DiffPanel(props: DiffPanelProps) {
  const git = props.git
  const repoPath = () => git.state.repoPath

  const isUntracked = () =>
    props.selected !== null && (git.state.status?.not_added.includes(props.selected.file) ?? false)

  const makeDiffQuery = (staged: boolean) =>
    createQuery(() => {
      const path = repoPath()
      const selected = props.selected
      return {
        queryKey: selected ? git.diffQueryKey(selected.file, staged) : ['diff', 'none', staged],
        enabled: Boolean(path && selected),
        queryFn: async (): Promise<FileDiff> => {
          if (!path || !selected) {
            throw new Error('No file selected')
          }
          const response = await sidecarFetch(
            SidecarOp.getDiff,
            { repoPath: path, file: selected.file, staged },
            GetDiffResponseSchema
          )
          if (response._tag === 'Ok') {
            return response.diff
          }
          if (response._tag === 'GitError') {
            throw new Error(response.message)
          }
          throw new Error('Repository not open')
        }
      }
    })

  const unstagedQuery = makeDiffQuery(false)
  const stagedQuery = makeDiffQuery(true)

  const unstagedDiff = () => (props.selected ? (unstagedQuery.data ?? null) : null)
  const stagedDiff = () => (props.selected ? (stagedQuery.data ?? null) : null)

  const unstagedHunks = () => unstagedDiff()?.hunks ?? []
  const stagedHunks = () => stagedDiff()?.hunks ?? []
  const isBinary = () => Boolean(unstagedDiff()?.binary || stagedDiff()?.binary)
  const hasError = () => unstagedQuery.isError || stagedQuery.isError
  const errorMessage = () => unstagedQuery.error?.message ?? stagedQuery.error?.message

  const totals = createMemo(() => {
    let adds = 0
    let dels = 0
    for (const hunk of [...unstagedHunks(), ...stagedHunks()]) {
      for (const line of hunk.lines) {
        if (line.kind === 'add') {
          adds++
        } else if (line.kind === 'del') {
          dels++
        }
      }
    }
    return { adds, dels }
  })

  // Both diffs share the index as a coordinate system: the staged diff's "new" side and
  // the unstaged diff's "old" side are the index. Sorting on those keeps document order,
  // and remapping the index side to HEAD/worktree coordinates keeps the displayed line
  // numbers stable when a hunk moves between staged and unstaged.
  const mergedHunks = createMemo<HunkEntry[]>(() => {
    const staged = stagedHunks()
    const unstaged = unstagedHunks()
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
  })

  const hasAnyHunks = () => mergedHunks().length > 0

  const fileStageState = () => {
    if (stagedHunks().length === 0) {
      return 'unstaged'
    }
    return unstagedHunks().length > 0 ? 'partial' : 'staged'
  }

  const toggleFileStaged = () => {
    const file = props.selected?.file
    if (!file) {
      return
    }
    if (fileStageState() === 'staged') {
      void git.unstageFile(file)
    } else {
      void git.stageFile(file)
    }
  }

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <Show when={props.selected} fallback={<div className="border-b" />}>
        {(selected) => (
          <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 border-b py-1.5 pl-3.5 pr-2">
            <Show when={hasAnyHunks() && !isBinary()}>
              <Checkbox
                checked={fileStageState() === 'staged'}
                indeterminate={fileStageState() === 'partial'}
                aria-label={
                  fileStageState() === 'staged'
                    ? `Unstage ${selected().file}`
                    : `Stage ${selected().file}`
                }
                onChange={toggleFileStaged}
              />
            </Show>
            <span className="min-w-0 truncate text-sm font-semibold" title={selected().file}>
              {selected().file}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
              <span className="text-add">+{totals().adds}</span>
              <span className="text-del">−{totals().dels}</span>
            </span>
            <div className="flex-1" />
          </div>
        )}
      </Show>

      <div className="min-h-0 overflow-auto p-2" data-testid="diff-body">
        <Show
          when={props.selected}
          fallback={
            <EmptyState
              size="sm"
              icon={FileDiffIcon}
              title="No file selected"
              description="Select a file on the left to review its changes."
            />
          }
        >
          <Show when={!hasError()} fallback={<DiffError message={errorMessage()} />}>
            <Show
              when={!isBinary()}
              fallback={
                <div className="px-2 py-4 text-sm text-muted-foreground">
                  Binary file — no preview available.
                </div>
              }
            >
              <Show
                when={hasAnyHunks()}
                fallback={
                  <div className="px-2 py-4 text-sm text-muted-foreground">No changes to show.</div>
                }
              >
                <For each={mergedHunks()}>
                  {(entry) => (
                    <HunkCard
                      hunk={entry.display}
                      filePath={props.selected?.file ?? ''}
                      opHeader={entry.hunk.header}
                      staged={entry.staged}
                      hunkActionsEnabled={entry.staged || !isUntracked()}
                      onStageHunk={(header) =>
                        void git.stageHunk(props.selected?.file ?? '', header)
                      }
                      onUnstageHunk={(header) =>
                        void git.unstageHunk(props.selected?.file ?? '', header)
                      }
                    />
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}

interface HunkEntry {
  hunk: DiffHunk
  display: DiffHunk
  staged: boolean
  indexStart: number
}

const HUNK_RANGE_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/

function remapHunk(hunk: DiffHunk, oldShift: number, newShift: number): DiffHunk {
  if (oldShift === 0 && newShift === 0) {
    return hunk
  }
  const oldStart = hunk.oldStart + oldShift
  const newStart = hunk.newStart + newShift
  const tail = hunk.header.replace(HUNK_RANGE_RE, '')
  return {
    ...hunk,
    oldStart,
    newStart,
    header: `@@ -${oldStart},${hunk.oldCount} +${newStart},${hunk.newCount} @@${tail}`,
    lines: hunk.lines.map((line) => ({
      ...line,
      oldLine: line.oldLine === null ? null : line.oldLine + oldShift,
      newLine: line.newLine === null ? null : line.newLine + newShift
    }))
  }
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
  opHeader: string
  staged: boolean
  hunkActionsEnabled: boolean
  onStageHunk: (header: string) => void
  onUnstageHunk: (header: string) => void
}

function HunkCard(props: HunkCardProps) {
  const toggle = () => {
    if (props.staged) {
      props.onUnstageHunk(props.opHeader)
    } else {
      props.onStageHunk(props.opHeader)
    }
  }

  const highlightQuery = createQuery<Array<LineTokens | null> | null>(() => ({
    queryKey: ['hunk-highlight', props.filePath, hunkHighlightKey(props.hunk)],
    enabled: languageForFile(props.filePath) !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: () => highlightHunk(props.filePath, props.hunk.lines)
  }))

  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border" data-testid="diff-hunk">
      <div className="flex h-8 items-center gap-2.5 border-b bg-card-2 px-2.5">
        <Show when={props.hunkActionsEnabled}>
          <Checkbox
            checked={props.staged}
            onChange={toggle}
            aria-label={props.staged ? 'Unstage hunk' : 'Stage hunk'}
          />
        </Show>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {props.hunk.header}
        </span>
      </div>
      <For each={props.hunk.lines}>
        {(line, index) => (
          <DiffLineRow line={line} tokens={highlightQuery.data?.[index()] ?? null} />
        )}
      </For>
    </div>
  )
}

function DiffLineRow(props: { line: DiffLine; tokens: LineTokens | null }) {
  const line = props.line
  if (line.kind === 'meta') {
    return (
      <div className="px-2 py-0.5 font-mono text-[14px] text-muted-foreground">{line.text}</div>
    )
  }
  return (
    <div
      className={cn(
        'grid grid-cols-[44px_44px_16px_minmax(0,1fr)] items-baseline whitespace-pre-wrap break-words font-mono text-[14px] leading-[24px]',
        line.kind === 'add' && 'bg-[var(--add-bg)]',
        line.kind === 'del' && 'bg-[var(--del-bg)]'
      )}
    >
      <span className="select-none pr-2 text-right text-muted-foreground/60">
        {line.oldLine ?? ''}
      </span>
      <span className="select-none pr-2 text-right text-muted-foreground/60">
        {line.newLine ?? ''}
      </span>
      <span
        className={cn(
          'select-none text-center',
          line.kind === 'add' && 'text-add',
          line.kind === 'del' && 'text-del'
        )}
      >
        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
      </span>
      <span>
        <Show when={props.tokens} fallback={line.text}>
          {(tokens) => (
            <For each={tokens()}>
              {(token) => (
                <span
                  className="text-(--shiki-light) dark:text-(--shiki-dark)"
                  style={{ '--shiki-light': token.lightColor, '--shiki-dark': token.darkColor }}
                >
                  {token.content}
                </span>
              )}
            </For>
          )}
        </Show>
      </span>
    </div>
  )
}
