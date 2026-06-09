import type { DiffHunk, DiffLine, FileDiff } from '@shared/schemas/git'
import { GetDiffResponseSchema } from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import { FileDiffIcon } from 'lucide-react'
import { createMemo, For, Show } from '@/lib/react-compat'
import { createQuery } from '@/lib/react-query-compat'
import { sidecarFetch } from '@/lib/sidecar-fetch'
import { cn } from '@/lib/utils'
import type { GitStore } from '@/stores/git'
import type { SelectedFile } from '../StatusPanel'
import { EmptyState } from '../ui/empty-state'

interface DiffPanelProps {
  git: GitStore
  selected: SelectedFile | null
}

export function DiffPanel(props: DiffPanelProps) {
  const git = props.git
  const repoPath = () => git.state.repoPath

  const isUntracked = () =>
    props.selected !== null &&
    !props.selected.staged &&
    (git.state.status?.not_added.includes(props.selected.file) ?? false)

  const diffQuery = createQuery(() => {
    const path = repoPath()
    const selected = props.selected
    return {
      queryKey: selected ? git.diffQueryKey(selected.file, selected.staged) : ['diff', 'none'],
      enabled: Boolean(path && selected),
      queryFn: async (): Promise<FileDiff> => {
        if (!path || !selected) {
          throw new Error('No file selected')
        }
        const response = await sidecarFetch(
          SidecarOp.getDiff,
          { repoPath: path, file: selected.file, staged: selected.staged },
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

  const diff = () => (props.selected ? (diffQuery.data ?? null) : null)
  const totals = createMemo(() => {
    const current = diff()
    let adds = 0
    let dels = 0
    for (const hunk of current?.hunks ?? []) {
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

  const toggleFileStaged = () => {
    const selected = props.selected
    if (!selected) {
      return
    }
    if (selected.staged) {
      void git.unstageFile(selected.file)
    } else {
      void git.stageFile(selected.file)
    }
  }

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <Show when={props.selected} fallback={<div className="border-b" />}>
        {(selected) => (
          <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 border-b py-1.5 pl-3.5 pr-2">
            <span className="min-w-0 truncate text-sm font-semibold" title={selected().file}>
              {selected().file}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
              <span className="text-add">+{totals().adds}</span>
              <span className="text-del">−{totals().dels}</span>
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={toggleFileStaged}
              className="h-7 shrink-0 rounded-[var(--r-sm)] border bg-card-2 px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              {selected().staged ? 'Unstage file' : 'Stage file'}
            </button>
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
          <Show
            when={!diffQuery.isError}
            fallback={<DiffError message={diffQuery.error?.message} />}
          >
            <Show when={diff()}>
              {(loadedDiff) => (
                <Show
                  when={!loadedDiff().binary}
                  fallback={
                    <div className="px-2 py-4 text-sm text-muted-foreground">
                      Binary file — no preview available.
                    </div>
                  }
                >
                  <Show
                    when={loadedDiff().hunks.length > 0}
                    fallback={
                      <div className="px-2 py-4 text-sm text-muted-foreground">
                        No changes to show.
                      </div>
                    }
                  >
                    <For each={loadedDiff().hunks}>
                      {(hunk) => (
                        <HunkCard
                          hunk={hunk}
                          staged={props.selected?.staged ?? false}
                          hunkActionsEnabled={!isUntracked()}
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
              )}
            </Show>
          </Show>
        </Show>
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
  staged: boolean
  hunkActionsEnabled: boolean
  onStageHunk: (header: string) => void
  onUnstageHunk: (header: string) => void
}

function HunkCard(props: HunkCardProps) {
  const toggle = () => {
    if (props.staged) {
      props.onUnstageHunk(props.hunk.header)
    } else {
      props.onStageHunk(props.hunk.header)
    }
  }

  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border" data-testid="diff-hunk">
      <div className="flex h-8 items-center gap-2.5 border-b bg-card-2 px-2.5">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{props.hunk.header}</span>
        <div className="flex-1" />
        <Show when={props.hunkActionsEnabled}>
          <button
            type="button"
            onClick={toggle}
            className="h-[22px] shrink-0 rounded-[var(--r-xs)] bg-[var(--brand-soft)] px-2 text-[11px] font-semibold text-brand transition-colors hover:bg-brand/25"
          >
            {props.staged ? 'Unstage hunk' : 'Stage hunk'}
          </button>
        </Show>
      </div>
      <For each={props.hunk.lines}>{(line) => <DiffLineRow line={line} />}</For>
    </div>
  )
}

function DiffLineRow(props: { line: DiffLine }) {
  const line = props.line
  if (line.kind === 'meta') {
    return <div className="px-2 py-0.5 text-xs text-muted-foreground">{line.text}</div>
  }
  return (
    <div
      className={cn(
        'grid grid-cols-[40px_40px_16px_minmax(0,1fr)] items-baseline whitespace-pre-wrap break-words text-xs leading-5',
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
      <span>{line.text}</span>
    </div>
  )
}
