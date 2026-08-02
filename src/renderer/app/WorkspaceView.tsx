import type { ComponentProps, ReactNode } from 'react'
import { CommitDetailPane } from '@/features/history/CommitDetailPane'
import { HistoryPanel } from '@/features/history/HistoryPanel'
import { LocalChangesPane } from '@/features/status/LocalChangesPane'
import { WorkingCopyHeader } from '@/features/status/WorkingCopyHeader'
import { ListColumnHeader } from '@/shell/ListColumnHeader'
import { COLUMN_HEADER_HEIGHT, Shell } from '@/shell/Shell'
import { StatusDock } from '@/shell/StatusDock'

export interface WorkspaceViewProps {
  repoPath: ComponentProps<typeof Shell>['repoPath']
  currentBranch: ComponentProps<typeof Shell>['currentBranch']
  branchBrowser: ComponentProps<typeof Shell>['branchBrowser']
  banner: ReactNode
  historyPanel: ComponentProps<typeof HistoryPanel>
  workingCopySelected: boolean
  workingCopyBranch: ComponentProps<typeof LocalChangesPane>['currentBranch']
  commitDetailPane: ComponentProps<typeof CommitDetailPane>
  listColumnHeader: ComponentProps<typeof ListColumnHeader>
  statusDock: ComponentProps<typeof StatusDock>
  totalChanges: number
  stagedCount: number
  dialogs: ReactNode
  pullDialog: ReactNode
}

export function WorkspaceView(props: WorkspaceViewProps) {
  const detailPane = props.workingCopySelected ? (
    <>
      <div style={{ height: `${COLUMN_HEADER_HEIGHT}px` }} className="shrink-0 border-b">
        <WorkingCopyHeader />
      </div>
      <LocalChangesPane currentBranch={props.workingCopyBranch} />
    </>
  ) : (
    <CommitDetailPane {...props.commitDetailPane} />
  )

  return (
    <Shell
      repoPath={props.repoPath}
      currentBranch={props.currentBranch}
      branchBrowser={props.branchBrowser}
      banner={props.banner}
      listHeader={<ListColumnHeader {...props.listColumnHeader} />}
      listBody={<HistoryPanel {...props.historyPanel} />}
      detailPane={detailPane}
      statusDock={<StatusDock {...props.statusDock} />}
    >
      <span className="sr-only">
        {props.totalChanges} changed files, {props.stagedCount} staged
      </span>
      {props.dialogs}
      {props.pullDialog}
    </Shell>
  )
}
