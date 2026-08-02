import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useWorkspaceContext } from '@/app/WorkspaceContext'
import {
  assembleDrops,
  dropStateOf,
  type FileDrops,
  hunkDropped,
  toggleFileDrop,
  toggleHunkDrop
} from '@/features/commit/amend-drops'
import { CommitPanel } from '@/features/commit/CommitPanel'
import { DiffPanel } from '@/features/diff/DiffPanel'
import { buildHeadCommitRange } from '@/features/history/head-commit-range'
import {
  useActionRunner,
  useCommitHistory,
  useHeadCommit,
  useRepoSession,
  useWorkingTreeStatus
} from '@/stores/git'
import { useDraggablePane } from '../../hooks/useDraggablePane'
import { CleanWorkingTree } from './CleanWorkingTree'
import { ConflictBanner } from './ConflictBanner'
import { createLocalChangesActions } from './local-changes-actions'
import { type OperationSummary, summarizeOperation } from './operation-summary'
import { StashControl } from './StashControl'
import { type SelectedFile, StatusPanel } from './StatusPanel'
import { followSelection } from './selection-follow'
import { buildHeadCommitRows, buildStagedFilePaths } from './status-file-rows'
import {
  buildStatusGroups,
  type FileRowGroup,
  flattenStatusGroups,
  type StatusGroupRow
} from './status-groups'

const FILES_PANEL_WIDTH_MIN = 240
const FILES_PANEL_WIDTH_MAX = 620
const FILES_PANEL_WIDTH_DEFAULT = 320
const FILES_PANEL_WIDTH_KEY = 'rebase:local-files-width'

const loadFilesPanelWidth = async () => {
  const stored = Number(localStorage.getItem(FILES_PANEL_WIDTH_KEY))
  return {
    open: true,
    size: Number.isFinite(stored) && stored > 0 ? stored : FILES_PANEL_WIDTH_DEFAULT
  }
}

const saveFilesPanelWidth = (state: { size: number }) => {
  try {
    localStorage.setItem(FILES_PANEL_WIDTH_KEY, String(state.size))
  } catch {}
}

function conflictBlockedReason(
  conflictCount: number,
  summary: OperationSummary | null
): string | undefined {
  if (conflictCount > 0) {
    return 'Resolve and stage every conflicted file before committing.'
  }
  if (summary?.canContinue) {
    return `Finish this ${summary.noun} with Continue above, not a commit.`
  }
  return undefined
}

interface LocalChangesPaneProps {
  currentBranch: string
}

export function LocalChangesPane(props: LocalChangesPaneProps) {
  const { status, rows, statusState, stageFile, unstageFile } = useWorkingTreeStatus()
  const { commit, amend, loadHeadMessage, busy } = useActionRunner()
  const { opening } = useRepoSession()
  const history = useCommitHistory()
  const loading = opening || busy
  const { actions, prompt, confirm } = useWorkspaceContext()
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [amendActive, setAmendActive] = useState(false)
  const [drops, setDrops] = useState<FileDrops>(() => new Map())
  const headCommit = useHeadCommit(amendActive)
  const headFiles = headCommit.data?.files ?? []
  const headParentCount = headCommit.data?.parentCount ?? 0
  const amendRows = useMemo(
    () => (amendActive && headParentCount <= 1 ? buildHeadCommitRows(headFiles, drops) : []),
    [amendActive, headParentCount, headFiles, drops]
  )
  const { droppedHeadPaths, droppedHeadHunks } = useMemo(
    () => assembleDrops(drops, amendRows),
    [amendRows, drops]
  )

  const { size: filesWidth, onResizeStart } = useDraggablePane({
    min: FILES_PANEL_WIDTH_MIN,
    max: FILES_PANEL_WIDTH_MAX,
    defaultSize: FILES_PANEL_WIDTH_DEFAULT,
    load: loadFilesPanelWidth,
    save: saveFilesPanelWidth
  })

  const totalChanges = rows.length
  const stagedCount = rows.filter((row) => row.stageState !== 'unstaged').length
  const hasHeadCommit = (history.log?.all.length ?? 0) > 0
  const headAvailabilityLoading = history.logLoading && !hasHeadCommit
  const amendAvailable = hasHeadCommit || headAvailabilityLoading
  const conflictCount = status?.conflicted.length ?? 0
  const operation = status?.operation
  const amendDisabled = headAvailabilityLoading || conflictCount > 0 || operation !== undefined
  const operationSummary = operation ? summarizeOperation(operation) : null
  const commitBlockedReason = conflictBlockedReason(conflictCount, operationSummary)
  const {
    stashSelected,
    stashAll,
    handleFileAction,
    resolveConflict,
    requestAbortOperation,
    discardAll
  } = createLocalChangesActions({
    stageFile,
    unstageFile,
    actions,
    prompt,
    confirm,
    operationSummary,
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    reportCopySuccess: () => toast.success('Copied path'),
    reportCopyFailure: () => toast.error('Copy failed')
  })

  const groupRows = useMemo(() => flattenStatusGroups(buildStatusGroups(rows)), [rows])
  const previousGroupRows = useRef<StatusGroupRow[]>(groupRows)

  const stagedFiles = useMemo(() => buildStagedFilePaths(rows), [rows])

  const firstSelection = (): SelectedFile | null => {
    const first = groupRows[0]
    return first
      ? { file: first.row.file, renameSource: first.row.renameSource, group: first.group }
      : null
  }

  useEffect(() => {
    const previous = previousGroupRows.current
    previousGroupRows.current = groupRows
    if (selected?.source === 'head-commit') {
      return
    }
    const follow = followSelection({
      selected: selected ? { file: selected.file, group: selected.group ?? 'unstaged' } : null,
      previous,
      next: groupRows
    })
    if (follow.kind === 'keep') {
      return
    }
    setSelected(
      follow.kind === 'clear'
        ? null
        : { file: follow.file, renameSource: follow.renameSource, group: follow.group }
    )
  }, [groupRows, selected])

  const handleAmendChange = (active: boolean) => {
    setAmendActive(active)
    if (!active) {
      setDrops(new Map())
      setSelected((current) => (current?.source === 'head-commit' ? firstSelection() : current))
    }
  }

  const toggleHeadFileDrop = (file: string) => {
    setDrops((current) => toggleFileDrop(current, file))
  }

  const toggleHeadHunkDrop = (file: string, hunkHeader: string, allHeaders: string[]) => {
    setDrops((current) => toggleHunkDrop(current, file, hunkHeader, allHeaders))
  }

  const selectHeadFile = (file: string, renameSource?: string) => {
    const headSha = headCommit.data?.sha
    if (!headSha) {
      return
    }
    setSelected({
      file,
      renameSource,
      source: 'head-commit',
      range: buildHeadCommitRange(headParentCount, headSha)
    })
  }

  const selectWorktreeFile = (
    file: string,
    group: Exclude<FileRowGroup, 'head-commit'>,
    renameSource?: string
  ) => {
    setSelected({ file, renameSource, group })
  }

  const amendDrop =
    selected?.source === 'head-commit'
      ? {
          dropState: dropStateOf(drops, selected.file),
          isHunkDropped: (hunkHeader: string) => hunkDropped(drops, selected.file, hunkHeader),
          onToggleFile: () => toggleHeadFileDrop(selected.file),
          onToggleHunk: (hunkHeader: string, allHeaders: string[]) =>
            toggleHeadHunkDrop(selected.file, hunkHeader, allHeaders)
        }
      : undefined

  if (!status && statusState !== 'ready') {
    return <StatusPanel selected={null} onSelect={() => {}} loading={loading} />
  }

  if (totalChanges === 0 && !amendAvailable) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ConflictBanner
          busy={busy}
          onContinue={(noun) => void actions.continueOperation(noun)}
          onAbort={requestAbortOperation}
        />
        <CleanWorkingTree operation={operation} />
      </div>
    )
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      <div className="flex min-h-0 flex-col overflow-hidden">
        <ConflictBanner
          busy={busy}
          onContinue={(noun) => void actions.continueOperation(noun)}
          onAbort={requestAbortOperation}
        />
        {totalChanges > 0 || amendActive ? (
          <div
            className="grid min-h-0 flex-1 overflow-hidden"
            style={{
              gridTemplateColumns: `min(${filesWidth}px, calc(100% - 300px)) minmax(300px, 1fr)`
            }}
          >
            <div className="relative flex min-h-0 min-w-0 flex-col border-r">
              <div className="min-h-0 flex-1 overflow-hidden">
                <StatusPanel
                  selected={selected}
                  onSelect={(file, group, renameSource) =>
                    group === 'head-commit'
                      ? selectHeadFile(file, renameSource)
                      : selectWorktreeFile(file, group, renameSource)
                  }
                  onToggleDrop={toggleHeadFileDrop}
                  amendRows={amendRows}
                  onFileAction={handleFileAction}
                  onResolveConflict={resolveConflict}
                  headerActions={
                    totalChanges > 0 ? (
                      <>
                        <StashControl
                          stagedFiles={stagedFiles}
                          stagedCount={stagedCount}
                          hasChanges={totalChanges > 0}
                          busy={busy}
                          blockedReason={
                            operationSummary
                              ? `Finish or abort the ${operationSummary.noun} first.`
                              : undefined
                          }
                          onStashSelected={stashSelected}
                          onStashAll={stashAll}
                        />
                        <button
                          type="button"
                          onClick={discardAll}
                          className="h-7 shrink-0 rounded-[var(--r-sm)] border bg-card-2 px-2.5 text-xs text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                        >
                          Discard all
                        </button>
                      </>
                    ) : undefined
                  }
                  loading={loading}
                />
              </div>
              <span
                onMouseDown={(event) => onResizeStart(event.nativeEvent)}
                aria-hidden="true"
                className="group/files-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
              >
                <span className="w-px bg-border-strong/50 transition-colors group-hover/files-resize:bg-primary/70" />
              </span>
            </div>
            <div className="min-h-0 min-w-0 overflow-hidden">
              <DiffPanel selected={selected} amendDrop={amendDrop} />
            </div>
          </div>
        ) : headAvailabilityLoading ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <StatusPanel selected={null} onSelect={() => {}} loading={true} />
          </div>
        ) : (
          <CleanWorkingTree operation={operation} />
        )}
      </div>
      <CommitPanel
        onCommit={commit}
        onAmend={amend}
        loadHeadMessage={loadHeadMessage}
        onAmendChange={handleAmendChange}
        droppedHeadPaths={droppedHeadPaths}
        droppedHeadHunks={droppedHeadHunks}
        expectedHead={headCommit.data?.sha}
        amendAvailable={amendAvailable}
        amendDisabled={amendDisabled}
        loading={loading}
        branch={props.currentBranch || 'no-branch'}
        stagedCount={stagedCount}
        prefillMessage={operation?.kind === 'merge' ? operation.mergeMessage : undefined}
        concludesMerge={operation?.kind === 'merge'}
        commitBlockedReason={commitBlockedReason}
      />
    </div>
  )
}
