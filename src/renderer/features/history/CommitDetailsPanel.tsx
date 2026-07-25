import type { CommitDetail, CommitDetailFile } from '@shared/schemas/git'
import { CopyIcon, GitCommitHorizontalIcon, XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { DiffPanel } from '@/features/diff/DiffPanel'
import { parseRefs } from '@/features/history/graph/refs'
import type { SelectedFile } from '@/features/status/StatusPanel'
import type { CommitAction } from '@/lib/git-actions'
import type { GitLogEntry } from '@/types'
import { EmptyState } from '../../components/ui/empty-state'
import { LoadingBadge } from '../../components/ui/loading-badge'
import { CommitFileList } from './CommitFileList'
import { CommitMeta } from './CommitMeta'
import { firstCommitTreeFile } from './commit-file-tree'
import type { CommitSelection } from './commit-selection'
import { useCommitDetail, useCommitDetails } from './hooks/useCommitDetail'
import { RefBadge } from './RefBadge'

// Reading every selected commit costs one git call each, so a shift-click over hundreds of rows
// summarises the leading run rather than stampeding the sidecar. The panel says so when it does.
const SUMMARY_STAT_LIMIT = 50

interface CommitDetailsPanelProps {
  selection: CommitSelection
  commitsByHash: ReadonlyMap<string, GitLogEntry>
  remotes: Record<string, string>
  remoteNames: Set<string>
  laneHex: string
  height: number
  onResizeStart: (event: MouseEvent) => void
  onClose: () => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
}

export function CommitDetailsPanel(props: CommitDetailsPanelProps) {
  const shas = props.selection.shas
  const singleSha = shas.length === 1 ? shas[0] : null

  return (
    <>
      <span
        onMouseDown={(event) => props.onResizeStart(event.nativeEvent)}
        aria-hidden="true"
        className="group/details-resize z-30 flex h-1.5 shrink-0 cursor-row-resize items-center justify-stretch"
      >
        <span className="h-px w-full bg-border-strong/50 transition-colors group-hover/details-resize:bg-primary/70" />
      </span>
      <section
        data-testid="commit-details-panel"
        aria-label="Commit details"
        className="flex max-h-[70%] shrink-0 flex-col overflow-hidden border-t bg-card"
        style={{ height: `${props.height}px` }}
      >
        {singleSha !== null ? (
          <SingleCommitDetails
            sha={singleSha}
            entry={props.commitsByHash.get(singleSha)}
            remotes={props.remotes}
            remoteNames={props.remoteNames}
            laneHex={props.laneHex}
            onClose={props.onClose}
            onCommitAction={props.onCommitAction}
          />
        ) : shas.length > 1 ? (
          <MultiCommitSummary
            shas={shas}
            commitsByHash={props.commitsByHash}
            onClose={props.onClose}
          />
        ) : (
          <>
            <DetailsHeader title="Commit details" onClose={props.onClose} />
            <EmptyState
              size="sm"
              icon={GitCommitHorizontalIcon}
              title="No commit selected"
              description="Select a commit in the timeline to see its details."
            />
          </>
        )}
      </section>
    </>
  )
}

function DetailsHeader(props: { title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <header className="flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1">
      <span className="min-w-0 truncate text-[13px] font-semibold">{props.title}</span>
      {props.children}
      <div className="flex-1" />
      <button
        type="button"
        onClick={props.onClose}
        aria-label="Close commit details"
        className="flex size-6 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </header>
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

function SingleCommitDetails(props: {
  sha: string
  entry: GitLogEntry | undefined
  remotes: Record<string, string>
  remoteNames: Set<string>
  laneHex: string
  onClose: () => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
}) {
  const detailQuery = useCommitDetail(props.sha)
  const detail = detailQuery.data
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const files = detail?.files ?? []

  // Content shows up without an extra click, on whichever file reads first in the tree. Re-runs when
  // the commit changes, since the previously selected path is rarely in the new commit.
  useEffect(() => {
    setSelectedPath((current) =>
      current !== null && files.some((file) => file.path === current)
        ? current
        : (firstCommitTreeFile(files)?.path ?? null)
    )
  }, [files])

  const selectedFile = files.find((file) => file.path === selectedPath)
  const selected = useMemo<SelectedFile | null>(
    () =>
      selectedFile
        ? {
            file: selectedFile.path,
            renameSource: selectedFile.oldPath,
            source: 'commit',
            commit: props.sha
          }
        : null,
    [selectedFile, props.sha]
  )

  const refs = useMemo(
    () => (props.entry ? parseRefs(props.entry.refs, props.remoteNames) : []),
    [props.entry, props.remoteNames]
  )
  const subject = detail?.subject ?? props.entry?.message ?? ''
  const totals = totalsOf(files)

  return (
    <>
      <DetailsHeader title={subject} onClose={props.onClose}>
        <span className="flex shrink-0 items-center gap-1">
          {refs.map((parsedRef) => (
            <RefBadge
              key={`${parsedRef.kind}:${parsedRef.label}`}
              parsedRef={parsedRef}
              laneHex={props.laneHex}
              remotes={props.remotes}
            />
          ))}
        </span>
        <button
          type="button"
          onClick={() => props.onCommitAction?.('copy-sha', props.sha, subject)}
          aria-label={`Copy full SHA ${props.sha}`}
          title={props.sha}
          className="flex shrink-0 items-center gap-1 rounded-[var(--r-sm)] px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {props.sha.slice(0, 7)}
          <CopyIcon className="size-3" aria-hidden="true" />
        </button>
        {detailQuery.isFetching ? <LoadingBadge /> : null}
      </DetailsHeader>

      {detailQuery.isError ? (
        <div className="px-3 py-4 text-sm text-destructive">
          Failed to load commit details
          {detailQuery.error instanceof Error ? `: ${detailQuery.error.message}` : '.'}
        </div>
      ) : detail ? (
        <>
          <CommitMeta
            detail={detail}
            fileCount={files.length}
            additions={totals.additions}
            deletions={totals.deletions}
          />
          {files.length === 0 ? (
            <EmptyState
              size="sm"
              icon={GitCommitHorizontalIcon}
              title="No file changes"
              description="This commit does not touch any files."
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(200px,280px)_minmax(0,1fr)] overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-col border-r">
                <CommitFileList
                  files={files}
                  selectedPath={selectedPath}
                  onSelect={(file) => setSelectedPath(file.path)}
                />
              </div>
              <div className="min-h-0 min-w-0 overflow-hidden">
                <DiffPanel selected={selected} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="px-3 py-4 text-sm text-muted-foreground">Loading commit details…</div>
      )}
    </>
  )
}

function MultiCommitSummary(props: {
  shas: readonly string[]
  commitsByHash: ReadonlyMap<string, GitLogEntry>
  onClose: () => void
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
    <>
      <DetailsHeader title={`${props.shas.length} commits selected`} onClose={props.onClose}>
        {pending ? <LoadingBadge /> : null}
      </DetailsHeader>
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
    </>
  )
}
