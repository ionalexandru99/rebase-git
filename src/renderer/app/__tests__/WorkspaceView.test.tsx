import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceView, type WorkspaceViewProps } from '../WorkspaceView'

vi.mock('@/shell/Shell', () => ({
  COLUMN_HEADER_HEIGHT: 34,
  Shell: (props: {
    banner: ReactNode
    listHeader: ReactNode
    listBody: ReactNode
    detailPane: ReactNode
    statusDock: ReactNode
    children: ReactNode
  }) => (
    <main data-testid="shell">
      {props.banner}
      <header>{props.listHeader}</header>
      <section data-testid="list-body">{props.listBody}</section>
      <section data-testid="detail-pane">{props.detailPane}</section>
      <footer>{props.statusDock}</footer>
      {props.children}
    </main>
  )
}))

vi.mock('@/features/history/HistoryPanel', () => ({
  HistoryPanel: (props: { currentBranch?: string }) => (
    <div data-testid="history-panel">{props.currentBranch}</div>
  )
}))

vi.mock('@/features/history/CommitDetailPane', () => ({
  CommitDetailPane: (props: { shas: readonly string[] }) => (
    <div data-testid="commit-detail">{props.shas.join(',')}</div>
  )
}))

vi.mock('@/features/status/LocalChangesPane', () => ({
  LocalChangesPane: (props: { currentBranch?: string }) => (
    <div data-testid="local-changes">{props.currentBranch}</div>
  )
}))

vi.mock('@/features/status/WorkingCopyHeader', () => ({
  WorkingCopyHeader: () => <div data-testid="working-copy-header">Working copy</div>
}))

vi.mock('@/shell/ListColumnHeader', () => ({
  ListColumnHeader: (props: { repoName: string }) => (
    <div data-testid="list-column-header">{props.repoName}</div>
  )
}))

vi.mock('@/shell/StatusDock', () => ({
  StatusDock: (props: { branch: string | null }) => (
    <div data-testid="status-dock">{props.branch}</div>
  )
}))

function workspaceViewProps(overrides: Partial<WorkspaceViewProps> = {}): WorkspaceViewProps {
  return {
    repoPath: '/repo',
    currentBranch: 'main',
    branchBrowser: {
      repoPath: '/repo',
      localBranches: ['main'],
      remoteBranches: [],
      tags: []
    },
    banner: <div>Repository warning</div>,
    historyPanel: {
      log: null,
      loading: false,
      currentBranch: 'main'
    },
    workingCopySelected: false,
    workingCopyBranch: 'main',
    commitDetailPane: {
      shas: ['abc123'],
      commitsByHash: new Map(),
      remotes: {},
      remoteNames: new Set()
    },
    listColumnHeader: {
      repoName: 'project',
      loadedCount: 1,
      visibleTotal: 1,
      visibleBranchCount: 1,
      filter: '',
      onFilterChange: vi.fn(),
      branchName: 'main',
      ahead: 0,
      behind: 0,
      detached: false,
      syncing: false,
      onFetch: vi.fn(),
      onPull: vi.fn(() => true),
      push: vi.fn(async () => ({ kind: 'ok' as const })),
      onResetLayout: vi.fn(),
      onCopyRepoPath: vi.fn()
    },
    statusDock: {
      branch: 'main',
      ahead: 0,
      behind: 0,
      status: null
    },
    totalChanges: 3,
    stagedCount: 2,
    dialogs: <div>Prompt dialog</div>,
    pullDialog: <div>Pull dialog</div>,
    ...overrides
  }
}

describe('WorkspaceView', () => {
  it('composes commit history, detail, repository chrome and overlays', () => {
    render(<WorkspaceView {...workspaceViewProps()} />)

    expect(screen.getByTestId('list-column-header')).toHaveTextContent('project')
    expect(screen.getByTestId('history-panel')).toHaveTextContent('main')
    expect(screen.getByTestId('commit-detail')).toHaveTextContent('abc123')
    expect(screen.getByTestId('status-dock')).toHaveTextContent('main')
    expect(screen.getByText('3 changed files, 2 staged')).toBeInTheDocument()
    expect(screen.getByText('Repository warning')).toBeInTheDocument()
    expect(screen.getByText('Prompt dialog')).toBeInTheDocument()
    expect(screen.getByText('Pull dialog')).toBeInTheDocument()
  })

  it('switches the detail column to the working copy surface', () => {
    render(<WorkspaceView {...workspaceViewProps({ workingCopySelected: true })} />)

    expect(screen.getByTestId('working-copy-header')).toBeInTheDocument()
    expect(screen.getByTestId('local-changes')).toHaveTextContent('main')
    expect(screen.queryByTestId('commit-detail')).not.toBeInTheDocument()
  })
})
