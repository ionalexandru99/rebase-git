import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useWorkspaceContext } from '@/app/WorkspaceContext'
import { CommitPanel } from '@/features/commit/CommitPanel'
import { DiffPanel } from '@/features/diff/DiffPanel'
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
import { StatusPanel } from './StatusPanel'
import { buildStagedFilePaths } from './status-file-rows'
import { useLocalChangesSelection } from './useLocalChangesSelection'

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
  const { repoPath, opening } = useRepoSession()
  const history = useCommitHistory()
  const loading = opening || busy
  const { actions, prompt, confirm } = useWorkspaceContext()
  const [amendActive, setAmendActive] = useState(false)
  const headCommit = useHeadCommit(amendActive)
  const headFiles = headCommit.data?.files ?? []
  const headParentCount = headCommit.data?.parentCount ?? 0
  const {
    selected,
    amendRows,
    droppedHeadPaths,
    droppedHeadHunks,
    amendDrop,
    resetAmend,
    selectFile,
    toggleHeadFileDrop
  } = useLocalChangesSelection({
    rows,
    headFiles,
    headParentCount,
    headSha: headCommit.data?.sha,
    amendActive
  })

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

  const stagedFiles = useMemo(() => buildStagedFilePaths(rows), [rows])

  const handleAmendChange = (active: boolean) => {
    setAmendActive(active)
    if (!active) {
      resetAmend()
    }
  }

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
                  onSelect={selectFile}
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
        repoPath={repoPath}
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
