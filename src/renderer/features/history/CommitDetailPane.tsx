import type { CommitDetail, CommitDetailFile } from '@shared/schemas/git'
import { GitCommitHorizontalIcon, MoreHorizontalIcon } from 'lucide-react'
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from 'react'
import { type CommitDiffSelection, CommitDiffView } from '@/features/diff/CommitDiffView'
import type { CommitAction } from '@/lib/git-actions'
import type { GitLogEntry } from '@/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'
import { EmptyState } from '../../components/ui/empty-state'
import { LoadingBadge } from '../../components/ui/loading-badge'
import { useDraggablePane } from '../../hooks/useDraggablePane'
import { CommitFileList } from './CommitFileList'
import { CommitMeta } from './CommitMeta'
import { firstCommitTreeFile } from './commit-file-tree'
import { useCommitDetail, useCommitDetails } from './hooks/useCommitDetail'

const SUMMARY_STAT_LIMIT = 50
const DETAIL_FILE_LIST_WIDTH = 232
const DETAIL_FILE_LIST_MIN_WIDTH = 160
const DETAIL_FILE_LIST_MAX_WIDTH = 480
const DETAIL_FILE_LIST_MAX_SHARE = '40%'
const DETAIL_FILE_LIST_WIDTH_KEY = 'rebase:commit-files-width'

const loadDetailFileListWidth = async () => {
  const stored = Number(window.localStorage.getItem(DETAIL_FILE_LIST_WIDTH_KEY))
  return {
    open: true,
    size: Number.isFinite(stored) && stored > 0 ? stored : DETAIL_FILE_LIST_WIDTH
  }
}

const saveDetailFileListWidth = (state: { size: number }) => {
  window.localStorage.setItem(DETAIL_FILE_LIST_WIDTH_KEY, String(state.size))
}

type CommitActionHandler = (action: CommitAction, sha: string, message: string) => void

interface CommitDetailPaneProps {
  shas: readonly string[]
  commitsByHash: ReadonlyMap<string, GitLogEntry>
  remotes: Record<string, string>
  remoteNames: Set<string>
  onCommitAction?: CommitActionHandler
}

export const COMMIT_DETAIL_HEADER_HEIGHT = 34

function PaneHeader(props: { title: string; children?: ReactNode }) {
  return (
    <header
      style={{ height: `${COMMIT_DETAIL_HEADER_HEIGHT}px` }}
      className="flex shrink-0 items-center gap-2 border-b px-3"
    >
      <span className="shrink-0 text-[13px] font-semibold">{props.title}</span>
      {props.children}
    </header>
  )
}

export function CommitDetailPane(props: CommitDetailPaneProps) {
  const shas = props.shas

  if (shas.length === 1) {
    return (
      <SingleCommitDetail
        sha={shas[0]}
        entry={props.commitsByHash.get(shas[0])}
        remotes={props.remotes}
        remoteNames={props.remoteNames}
        onCommitAction={props.onCommitAction}
      />
    )
  }

  if (shas.length > 1) {
    return <MultiCommitSummary shas={shas} commitsByHash={props.commitsByHash} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="commit-detail-pane">
      <PaneHeader title="Commit" />
      <EmptyState
        size="sm"
        icon={GitCommitHorizontalIcon}
        title="No commit selected"
        description="Select a commit in the timeline to see its details."
      />
    </div>
  )
}

function totalsOf(files: readonly CommitDetailFile[]) {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return { additions, deletions }
}

const headerButtonClass =
  'inline-flex h-6 shrink-0 items-center rounded-[var(--r-sm)] bg-muted px-2 text-xs transition-colors hover:bg-border-strong'

function SingleCommitDetail(props: {
  sha: string
  entry: GitLogEntry | undefined
  remotes: Record<string, string>
  remoteNames: Set<string>
  onCommitAction?: CommitActionHandler
}) {
  const detailQuery = useCommitDetail(props.sha)
  const {
    size: fileListWidth,
    reset: resetFileListWidth,
    onResizeStart: onFileListResizeStart
  } = useDraggablePane({
    min: DETAIL_FILE_LIST_MIN_WIDTH,
    max: DETAIL_FILE_LIST_MAX_WIDTH,
    defaultSize: DETAIL_FILE_LIST_WIDTH,
    handle: 'end',
    load: loadDetailFileListWidth,
    save: saveDetailFileListWidth
  })
  const startFileListResize = (event: ReactMouseEvent) => {
    onFileListResizeStart(event.nativeEvent)
  }
  const detail = detailQuery.data
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const files = detail?.files ?? []

  useEffect(() => {
    setSelectedPath((current) =>
      current !== null && files.some((file) => file.path === current)
        ? current
        : (firstCommitTreeFile(files)?.path ?? null)
    )
  }, [files])

  const selectedFile = files.find((file) => file.path === selectedPath)
  const selected = useMemo<CommitDiffSelection | null>(
    () =>
      selectedFile
        ? {
            commit: props.sha,
            file: selectedFile.path,
            renameSource: selectedFile.oldPath,
            binary: selectedFile.binary
          }
        : null,
    [selectedFile, props.sha]
  )

  const subject = detail?.subject ?? props.entry?.message ?? ''
  const totals = totalsOf(files)
  const act = (action: CommitAction) => props.onCommitAction?.(action, props.sha, subject)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="commit-detail-pane">
      <PaneHeader title="Commit">
        <button
          type="button"
          onClick={() => act('copy-sha')}
          aria-label={`Copy full SHA ${props.sha}`}
          title={props.sha}
          className="shrink-0 rounded-[var(--r-sm)] px-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {props.sha.slice(0, 7)}
        </button>
        {detail ? (
          <span
            className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground"
            data-testid="commit-stats"
          >
            <span>
              {files.length} file{files.length === 1 ? '' : 's'}
            </span>
            {totals.additions > 0 || totals.deletions > 0 ? (
              <>
                <span className="text-add">+{totals.additions}</span>
                <span className="text-del">−{totals.deletions}</span>
              </>
            ) : null}
          </span>
        ) : null}
        {detailQuery.isFetching ? <LoadingBadge /> : null}
        <div className="flex-1" />
        <button type="button" onClick={() => act('revert')} className={headerButtonClass}>
          Revert
        </button>
        <button type="button" onClick={() => act('cherry-pick')} className={headerButtonClass}>
          Cherry-pick
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Commit actions"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-muted transition-colors hover:bg-border-strong"
          >
            <MoreHorizontalIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent portal className="min-w-44">
            <DropdownMenuItem onSelect={() => act('copy-sha')}>Copy SHA</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act('copy-message')}>Copy message</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => act('branch-here')}>
              Create branch here
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => act('tag-here')}>Create tag here</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PaneHeader>

      {detailQuery.isError ? (
        <div className="px-3 py-4 text-sm text-destructive">
          Failed to load commit details
          {detailQuery.error instanceof Error ? `: ${detailQuery.error.message}` : '.'}
        </div>
      ) : detail ? (
        <>
          <CommitMeta
            detail={detail}
            entry={props.entry}
            remotes={props.remotes}
            remoteNames={props.remoteNames}
          />
          {files.length === 0 ? (
            <EmptyState
              size="sm"
              icon={GitCommitHorizontalIcon}
              title="No file changes"
              description="This commit does not touch any files."
            />
          ) : (
            <div
              data-testid="commit-detail-split"
              className="grid min-h-0 flex-1 overflow-hidden"
              style={{
                gridTemplateColumns: `min(${fileListWidth}px, ${DETAIL_FILE_LIST_MAX_SHARE}) minmax(0, 1fr)`
              }}
            >
              <div className="relative flex min-h-0 min-w-0 flex-col border-r">
                <CommitFileList
                  files={files}
                  selectedPath={selectedPath}
                  onSelect={(file) => setSelectedPath(file.path)}
                />
                <button
                  type="button"
                  aria-label="Resize changed files list"
                  title={`Changed files width: ${fileListWidth}px — double-click to reset`}
                  onMouseDown={startFileListResize}
                  onDoubleClick={resetFileListWidth}
                  className="group/files-resize absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
                >
                  <span className="mx-auto block h-full w-px bg-transparent transition-colors group-hover/files-resize:bg-primary/70" />
                </button>
              </div>
              <div className="min-h-0 min-w-0 overflow-hidden">
                <CommitDiffView selected={selected} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="px-3 py-4 text-sm text-muted-foreground">Loading commit details…</div>
      )}
    </div>
  )
}

function MultiCommitSummary(props: {
  shas: readonly string[]
  commitsByHash: ReadonlyMap<string, GitLogEntry>
}) {
  const counted = props.shas.slice(0, SUMMARY_STAT_LIMIT)
  const detailQueries = useCommitDetails(counted)
  const loaded = detailQueries
    .map((query) => query.data)
    .filter((detail): detail is CommitDetail => detail !== undefined)
  const files = loaded.flatMap((detail) => detail.files)
  const totals = totalsOf(files)
  const pending = detailQueries.some((query) => query.isPending)
  const truncated = props.shas.length > counted.length

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="commit-detail-pane">
      <PaneHeader title={`${props.shas.length} commits selected`}>
        {pending ? <LoadingBadge /> : null}
      </PaneHeader>
      <div className="shrink-0 border-b px-3 py-2 text-[13px] text-muted-foreground">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
          <span>
            {files.length} file change{files.length === 1 ? '' : 's'}
          </span>
          <span className="text-add">+{totals.additions}</span>
          <span className="text-del">−{totals.deletions}</span>
          {truncated ? (
            <span>
              combined stats cover the first {counted.length} of {props.shas.length}
            </span>
          ) : null}
        </span>
        <p className="mt-1">Select a single commit to see its diff.</p>
      </div>
      <ol
        className="scroll-host m-0 min-h-0 flex-1 list-none overflow-auto p-1.5"
        data-testid="commit-selection-summary"
      >
        {props.shas.map((sha, index) => (
          <li key={sha} className="flex h-7 items-center gap-2 px-2 text-sm">
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {sha.slice(0, 7)}
            </span>
            <span className="min-w-0 truncate">{props.commitsByHash.get(sha)?.message ?? ''}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
