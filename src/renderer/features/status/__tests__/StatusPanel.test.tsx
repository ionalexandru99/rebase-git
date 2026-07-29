import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HeadDropState } from '@/features/commit/amend-drops'
import type { ConflictSide } from '@/features/status/conflict-resolution'
import type { FileRowSource, UnifiedFileRow } from '@/features/status/status-file-rows'
import { buildUnifiedFileRows } from '@/features/status/status-file-rows'
import { type WorkingTreeStatus, WorkingTreeStatusProvider } from '@/features/status/store'
import type { FileAction } from '@/lib/git-actions'
import type { GitStatus } from '@/types'
import { type SelectedFile, StatusPanel } from '../StatusPanel'

type Code = { path: string; index: string; working_dir: string }

const code = (path: string, index: string, working_dir: string): Code => ({
  path,
  index,
  working_dir
})

function emptyStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    current: 'main',
    modified: [],
    staged: [],
    not_added: [],
    conflicted: [],
    deleted: [],
    created: [],
    renamed: [],
    files: [],
    ...overrides
  }
}

// StatusPanel now reads status and the staging mutations from the working-tree-status context, so
// each test injects them through the provider instead of through props.
function provideStatus(status: GitStatus | null, overrides: Partial<WorkingTreeStatus>) {
  const value: WorkingTreeStatus = {
    status,
    rows: status ? buildUnifiedFileRows(status) : [],
    statusState: status ? 'ready' : 'loading',
    statusLoading: false,
    stageFile: vi.fn(),
    unstageFile: vi.fn(),
    stageAll: vi.fn(),
    unstageAll: vi.fn(),
    stageHunk: vi.fn(),
    unstageHunk: vi.fn(),
    ...overrides
  }
  return (children: ReactNode) => (
    <WorkingTreeStatusProvider value={value}>{children}</WorkingTreeStatusProvider>
  )
}

function renderPanel(props: {
  status: GitStatus | null
  statusState?: WorkingTreeStatus['statusState']
  selected?: SelectedFile | null
  onSelect?: (file: string, source: FileRowSource) => void
  onStage?: WorkingTreeStatus['stageFile']
  onUnstage?: WorkingTreeStatus['unstageFile']
  onStageAll?: WorkingTreeStatus['stageAll']
  onUnstageAll?: WorkingTreeStatus['unstageAll']
  onToggleDrop?: (file: string) => void
  amendRows?: UnifiedFileRow[]
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
  onResolveConflict?: (file: string, side: ConflictSide) => void
  loading?: boolean
}) {
  const wrap = provideStatus(props.status, {
    statusState: props.statusState ?? (props.status ? 'ready' : 'loading'),
    stageFile: props.onStage ?? vi.fn(),
    unstageFile: props.onUnstage ?? vi.fn(),
    stageAll: props.onStageAll ?? vi.fn(),
    unstageAll: props.onUnstageAll ?? vi.fn()
  })
  return render(
    wrap(
      <StatusPanel
        selected={props.selected ?? null}
        onSelect={props.onSelect ?? vi.fn()}
        onToggleDrop={props.onToggleDrop}
        amendRows={props.amendRows}
        onFileAction={props.onFileAction}
        onResolveConflict={props.onResolveConflict}
        loading={props.loading ?? false}
      />
    )
  )
}

const amendRow = (path: string, dropState: HeadDropState = 'kept'): UnifiedFileRow => ({
  file: path,
  fileKind: 'modified',
  stageState: 'staged',
  isConflicted: false,
  isUntracked: false,
  source: 'head-commit',
  dropState
})

describe('StatusPanel', () => {
  it('renders nothing when status is null', () => {
    renderPanel({ status: null })
    expect(screen.queryByText('Changes')).not.toBeInTheDocument()
  })

  it('shows status as unavailable instead of calling the working tree clean', () => {
    renderPanel({ status: null, statusState: 'error' })

    expect(screen.getByText('Changes unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Working tree clean')).not.toBeInTheDocument()
  })

  it('fires file actions from the row context menu', async () => {
    const onFileAction = vi.fn()
    renderPanel({
      status: emptyStatus({ files: [code('a.ts', ' ', 'M')] }),
      onFileAction
    })
    fireEvent.contextMenu(screen.getByText('a.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard changes' }))
    expect(onFileAction).toHaveBeenCalledWith('discard', 'a.ts')

    fireEvent.contextMenu(screen.getByText('a.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy path' }))
    expect(onFileAction).toHaveBeenCalledWith('copy-path', 'a.ts')
  })

  it('lists every change in one flat list with a staged count', () => {
    renderPanel({
      status: emptyStatus({
        files: [
          code('a.ts', ' ', 'M'),
          code('b.ts', ' ', 'M'),
          code('c.ts', 'M', ' '),
          code('d.ts', '?', '?')
        ]
      })
    })

    expect(screen.getByText('4 files · 1 staged')).toBeInTheDocument()
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('c.ts')).toBeInTheDocument()
    expect(screen.getByText('d.ts')).toBeInTheDocument()
    expect(screen.queryByText('Staged')).not.toBeInTheDocument()
    expect(screen.queryByText('Untracked')).not.toBeInTheDocument()
  })

  it('renders a deleted file with a D badge', () => {
    renderPanel({ status: emptyStatus({ files: [code('gone.ts', ' ', 'D')] }) })
    expect(screen.getByText('gone.ts')).toBeInTheDocument()
    expect(screen.getByLabelText('deleted')).toBeInTheDocument()
  })

  it('leaves conflict guidance to the banner rendered outside the files pane', () => {
    renderPanel({
      status: emptyStatus({
        conflicted: ['src/conflict.ts'],
        files: [code('src/conflict.ts', 'U', 'U')]
      })
    })

    expect(screen.getByText('src/conflict.ts')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // The pairing intuition gets backwards, and StatusPanel is the only place the operation reaches
  // the rows: mid-rebase, index stage :2 ("ours") holds the branch being rebased ONTO. So the menu
  // item naming the onto-branch must dispatch side 'ours', end to end through the panel.
  it('resolves a rebase conflict toward the onto-branch with the ours side', async () => {
    const onResolveConflict = vi.fn()
    renderPanel({
      status: emptyStatus({
        conflicted: ['src/conflict.ts'],
        files: [code('src/conflict.ts', 'U', 'U')],
        operation: { kind: 'rebase-merge', oursLabel: 'main', theirsLabel: 'feature' }
      }),
      onResolveConflict
    })

    fireEvent.contextMenu(screen.getByText('src/conflict.ts'))
    expect(await screen.findByRole('menuitem', { name: 'Keep main' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Keep feature' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep main' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/conflict.ts', 'ours')
  })

  it('resolves a rebase conflict toward the replayed branch with the theirs side', async () => {
    const onResolveConflict = vi.fn()
    renderPanel({
      status: emptyStatus({
        conflicted: ['src/conflict.ts'],
        files: [code('src/conflict.ts', 'U', 'U')],
        operation: { kind: 'rebase-merge', oursLabel: 'main', theirsLabel: 'feature' }
      }),
      onResolveConflict
    })

    fireEvent.contextMenu(screen.getByText('src/conflict.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Keep feature' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/conflict.ts', 'theirs')
  })

  // A conflicted stash apply/pop is the one conflict git leaves with no operation behind it, so
  // there are no branch names to put on the menu items — the rows still have to offer both sides.
  it('names both sides generically when no operation supplies branch labels', async () => {
    const onResolveConflict = vi.fn()
    renderPanel({
      status: emptyStatus({
        conflicted: ['src/conflict.ts'],
        files: [code('src/conflict.ts', 'U', 'U')]
      }),
      onResolveConflict
    })

    fireEvent.contextMenu(screen.getByText('src/conflict.ts'))
    expect(
      await screen.findByRole('menuitem', { name: 'Keep the current version' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep the incoming version' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/conflict.ts', 'theirs')
  })

  it('renders renamed files as "from → to"', () => {
    renderPanel({
      status: emptyStatus({
        renamed: [{ from: 'old.ts', to: 'new.ts' }],
        files: [code('new.ts', 'R', ' ')]
      })
    })
    expect(screen.getByText('old.ts → new.ts')).toBeInTheDocument()
    expect(screen.getByLabelText('renamed')).toBeInTheDocument()
  })

  it('passes a staged rename source to unstage and discard actions', async () => {
    const onUnstage = vi.fn()
    const onFileAction = vi.fn()
    renderPanel({
      status: emptyStatus({
        renamed: [{ from: 'old.ts', to: 'new.ts' }],
        files: [code('new.ts', 'R', ' ')]
      }),
      onUnstage,
      onFileAction
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Unstage old.ts → new.ts' }))
    expect(onUnstage).toHaveBeenCalledWith('new.ts', 'old.ts')

    fireEvent.contextMenu(screen.getByText('old.ts → new.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard changes' }))
    expect(onFileAction).toHaveBeenCalledWith('discard', 'new.ts', 'old.ts')
  })

  it('shows a loading badge while loading', () => {
    renderPanel({ status: emptyStatus(), loading: true })
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('stages an unstaged file through its checkbox', () => {
    const onStage = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', ' ', 'M')] }), onStage })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Stage index.ts' }))
    expect(onStage).toHaveBeenCalledWith('index.ts')
  })

  it('unstages a staged file through its checkbox', () => {
    const onUnstage = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', 'M', ' ')] }), onUnstage })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Unstage index.ts' }))
    expect(onUnstage).toHaveBeenCalledWith('index.ts')
  })

  it('renders a partially-staged file as indeterminate and stages the rest on click', () => {
    const onStage = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', 'M', 'M')] }), onStage })

    const checkbox = screen.getByRole('checkbox', { name: 'Stage index.ts' }) as HTMLInputElement
    expect(checkbox.indeterminate).toBe(true)
    fireEvent.click(checkbox)
    expect(onStage).toHaveBeenCalledWith('index.ts')
  })

  it('selects a file when its row is clicked, tagging the worktree source', () => {
    const onSelect = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', ' ', 'M')] }), onSelect })

    fireEvent.click(screen.getByText('index.ts'))
    expect(onSelect).toHaveBeenCalledWith('index.ts', 'worktree')
  })

  it('folds amend rows into the same list with drop checkboxes and counts them', () => {
    const onToggleDrop = vi.fn()
    renderPanel({
      status: emptyStatus({ files: [code('work.ts', ' ', 'M')] }),
      amendRows: [amendRow('committed.ts')],
      onToggleDrop
    })

    expect(screen.getByText('2 files · 0 staged')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Working tree' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Last commit' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Stage work.ts' })).toBeInTheDocument()

    const dropBox = screen.getByRole('checkbox', { name: /drop committed\.ts from last commit/i })
    expect(dropBox).toBeChecked()
    fireEvent.click(dropBox)
    expect(onToggleDrop).toHaveBeenCalledWith('committed.ts')
  })

  it('labels grouped rows only through their section heading', () => {
    renderPanel({
      status: emptyStatus({ files: [code('work.ts', ' ', 'M')] }),
      amendRows: [amendRow('committed.ts')]
    })

    expect(screen.getAllByText('Last commit')).toHaveLength(1)
    expect(screen.getAllByText('Working tree')).toHaveLength(1)
  })

  it('omits the working tree section when only the last commit has rows', () => {
    renderPanel({ status: emptyStatus(), amendRows: [amendRow('committed.ts')] })

    expect(screen.getByRole('heading', { name: 'Last commit' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Working tree' })).not.toBeInTheDocument()
    expect(screen.getByText('committed.ts')).toBeInTheDocument()
  })

  it('highlights the selected file row', () => {
    renderPanel({
      status: emptyStatus({ files: [code('index.ts', ' ', 'M')] }),
      selected: { file: 'index.ts' }
    })

    const row = screen.getByText('index.ts').closest('[data-testid="status-file-row"]')
    expect(row?.className).toMatch(/brand-soft/)
  })

  it('stages every unstaged file in one call via the "Stage all" button', () => {
    const onStageAll = vi.fn()
    renderPanel({
      status: emptyStatus({
        files: [code('a.ts', ' ', 'M'), code('b.ts', '?', '?'), code('c.ts', 'M', ' ')]
      }),
      onStageAll
    })

    fireEvent.click(screen.getByRole('button', { name: 'Stage all' }))
    expect(onStageAll).toHaveBeenCalledTimes(1)
    expect(onStageAll).toHaveBeenCalledWith(['a.ts', 'b.ts'])
  })

  it('unstages everything in one call via the "Unstage all" button when all staged', () => {
    const onUnstageAll = vi.fn()
    renderPanel({
      status: emptyStatus({ files: [code('a.ts', 'M', ' '), code('b.ts', 'M', ' ')] }),
      onUnstageAll
    })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage all' }))
    expect(onUnstageAll).toHaveBeenCalledTimes(1)
    expect(onUnstageAll).toHaveBeenCalledWith(['a.ts', 'b.ts'])
  })

  it('includes both paths of a staged rename when unstaging all', () => {
    const onUnstageAll = vi.fn()
    renderPanel({
      status: emptyStatus({
        renamed: [{ from: 'old.ts', to: 'new.ts' }],
        files: [code('new.ts', 'R', ' ')]
      }),
      onUnstageAll
    })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage all' }))
    expect(onUnstageAll).toHaveBeenCalledWith(['old.ts', 'new.ts'])
  })

  it('truncates long file names and exposes the full path as a title attribute', () => {
    const longPath = 'src/very/deep/nested/path/component.tsx'
    renderPanel({ status: emptyStatus({ files: [code(longPath, ' ', 'M')] }) })
    const fileSpan = screen.getByText(longPath)
    expect(fileSpan.className).toMatch(/truncate/)
    expect(fileSpan).toHaveAttribute('title', longPath)
  })
})
