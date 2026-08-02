import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HeadDropState } from '@/features/commit/amend-drops'
import type { ConflictSide } from '@/features/status/conflict-resolution'
import type { UnifiedFileRow } from '@/features/status/status-file-rows'
import { buildUnifiedFileRows } from '@/features/status/status-file-rows'
import type { FileRowGroup } from '@/features/status/status-groups'
import { type WorkingTreeStatus, WorkingTreeStatusProvider } from '@/features/status/store'
import type { FileAction } from '@/lib/git-actions'
import type { GitStatus } from '@/types'
import { makeGitStatus } from '../../../../test/builders'
import { type SelectedFile, StatusPanel } from '../StatusPanel'

type Code = { path: string; index: string; working_dir: string }

const code = (path: string, index: string, working_dir: string): Code => ({
  path,
  index,
  working_dir
})

function emptyStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return makeGitStatus(overrides)
}

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
    discardHunk: vi.fn(),
    stageLines: vi.fn(),
    unstageLines: vi.fn(),
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
  onSelect?: (file: string, group: FileRowGroup) => void
  onStage?: WorkingTreeStatus['stageFile']
  onUnstage?: WorkingTreeStatus['unstageFile']
  onStageAll?: WorkingTreeStatus['stageAll']
  onUnstageAll?: WorkingTreeStatus['unstageAll']
  onToggleDrop?: (file: string) => void
  amendRows?: UnifiedFileRow[]
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
  onResolveConflict?: (file: string, side: ConflictSide) => void
  headerActions?: ReactNode
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
        headerActions={props.headerActions}
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

const groupOf = (file: string) =>
  screen
    .getAllByTestId('status-file-row')
    .filter((row) => row.textContent?.includes(file))
    .map((row) => row.getAttribute('data-group'))

describe('StatusPanel', () => {
  it('renders nothing when status is null', () => {
    renderPanel({ status: null })
    expect(screen.queryByTestId('status-file-scroll')).not.toBeInTheDocument()
  })

  it('leaves the file counts to the working-copy header', () => {
    renderPanel({ status: emptyStatus({ files: [code('a.ts', ' ', 'M')] }) })

    expect(screen.queryByText(/files · /)).not.toBeInTheDocument()
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

  it('splits the changes into staged and unstaged groups with per-group counts', () => {
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

    expect(screen.getByRole('heading', { name: 'Staged' }).closest('li')).toHaveTextContent('1')
    expect(screen.getByRole('heading', { name: 'Unstaged' }).closest('li')).toHaveTextContent('3')
    expect(groupOf('c.ts')).toEqual(['staged'])
    expect(groupOf('a.ts')).toEqual(['unstaged'])
    expect(groupOf('d.ts')).toEqual(['unstaged'])
    expect(screen.queryByRole('heading', { name: 'Conflicts' })).not.toBeInTheDocument()
  })

  it('lists a partially-staged file in both groups', () => {
    renderPanel({ status: emptyStatus({ files: [code('index.ts', 'M', 'M')] }) })

    expect(groupOf('index.ts')).toEqual(['staged', 'unstaged'])
  })

  it('sorts conflicts into their own group above the rest', () => {
    renderPanel({
      status: emptyStatus({
        conflicted: ['src/conflict.ts'],
        files: [code('src/conflict.ts', 'U', 'U'), code('a.ts', 'M', ' ')]
      })
    })

    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(headings).toEqual(['Conflicts', 'Staged'])
    expect(groupOf('src/conflict.ts')).toEqual(['conflicts'])
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

    fireEvent.click(screen.getByRole('button', { name: 'Unstage old.ts → new.ts' }))
    expect(onUnstage).toHaveBeenCalledWith('new.ts', 'old.ts')

    fireEvent.contextMenu(screen.getByText('old.ts → new.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard changes' }))
    expect(onFileAction).toHaveBeenCalledWith('discard', 'new.ts', 'old.ts')
  })

  it('shows a loading badge while loading', () => {
    renderPanel({ status: emptyStatus(), loading: true })
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('stages an unstaged file through its row button', () => {
    const onStage = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', ' ', 'M')] }), onStage })

    fireEvent.click(screen.getByRole('button', { name: 'Stage index.ts' }))
    expect(onStage).toHaveBeenCalledWith('index.ts')
  })

  it('unstages a staged file through its row button', () => {
    const onUnstage = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', 'M', ' ')] }), onUnstage })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage index.ts' }))
    expect(onUnstage).toHaveBeenCalledWith('index.ts')
  })

  it('stages a file by double-clicking its row', () => {
    const onStage = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', ' ', 'M')] }), onStage })

    fireEvent.doubleClick(screen.getByText('index.ts'))
    expect(onStage).toHaveBeenCalledWith('index.ts')
  })

  it('selects a file with the group its row was picked from', () => {
    const onSelect = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', 'M', 'M')] }), onSelect })

    const [stagedRow, unstagedRow] = screen.getAllByText('index.ts')
    fireEvent.click(stagedRow as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith('index.ts', 'staged')

    fireEvent.click(unstagedRow as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith('index.ts', 'unstaged')
  })

  it('folds amend rows into their own group with drop checkboxes and counts them', () => {
    const onToggleDrop = vi.fn()
    renderPanel({
      status: emptyStatus({ files: [code('work.ts', ' ', 'M')] }),
      amendRows: [amendRow('committed.ts')],
      onToggleDrop
    })

    expect(screen.getByRole('heading', { name: 'Unstaged' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Last commit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stage work.ts' })).toBeInTheDocument()

    const dropBox = screen.getByRole('checkbox', { name: /drop committed\.ts from last commit/i })
    expect(dropBox).toBeChecked()
    fireEvent.click(dropBox)
    expect(onToggleDrop).toHaveBeenCalledWith('committed.ts')
  })

  it('omits the working-copy groups when only the last commit has rows', () => {
    renderPanel({ status: emptyStatus(), amendRows: [amendRow('committed.ts')] })

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Last commit'
    ])
    expect(screen.getByText('committed.ts')).toBeInTheDocument()
  })

  it('highlights the selected file row', () => {
    renderPanel({
      status: emptyStatus({ files: [code('index.ts', ' ', 'M')] }),
      selected: { file: 'index.ts', group: 'unstaged' }
    })

    const row = screen.getByText('index.ts').closest('[data-testid="status-file-row"]')
    expect(row?.className).toMatch(/brand-soft/)
  })

  it('stages every unstaged file in one call from the group heading', () => {
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

  it('unstages every staged file in one call from the group heading', () => {
    const onUnstageAll = vi.fn()
    renderPanel({
      status: emptyStatus({ files: [code('a.ts', 'M', ' '), code('b.ts', 'M', ' ')] }),
      onUnstageAll
    })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage all' }))
    expect(onUnstageAll).toHaveBeenCalledTimes(1)
    expect(onUnstageAll).toHaveBeenCalledWith(['a.ts', 'b.ts'])
  })

  it('offers both group actions while each group has rows', () => {
    renderPanel({
      status: emptyStatus({ files: [code('a.ts', ' ', 'M'), code('b.ts', 'M', ' ')] })
    })

    expect(screen.getByRole('button', { name: 'Stage all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unstage all' })).toBeInTheDocument()
  })

  it('offers no bulk staging action on the conflicts group', () => {
    renderPanel({
      status: emptyStatus({
        conflicted: ['src/conflict.ts'],
        files: [code('src/conflict.ts', 'U', 'U')]
      })
    })

    expect(screen.queryByRole('button', { name: 'Stage all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unstage all' })).not.toBeInTheDocument()
  })

  it('includes both paths of a staged rename when unstaging a group', () => {
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

  it('renders the header actions it is given', () => {
    renderPanel({
      status: emptyStatus({ files: [code('a.ts', ' ', 'M')] }),
      headerActions: <button type="button">Discard all</button>
    })

    expect(screen.getByRole('button', { name: 'Discard all' })).toBeInTheDocument()
  })

  it('truncates long file names and exposes the full path as a title attribute', () => {
    const longPath = 'src/very/deep/nested/path/component.tsx'
    renderPanel({ status: emptyStatus({ files: [code(longPath, ' ', 'M')] }) })
    const fileSpan = screen.getByText(longPath)
    expect(fileSpan.className).toMatch(/truncate/)
    expect(fileSpan).toHaveAttribute('title', longPath)
  })
})
