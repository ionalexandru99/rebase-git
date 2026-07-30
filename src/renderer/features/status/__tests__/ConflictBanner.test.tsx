import type { OperationState } from '@shared/schemas/git'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDialogs } from '@/components/ui/prompt-dialog'
import { type WorkingTreeStatus, WorkingTreeStatusProvider } from '@/features/status/store'
import type { GitStatus } from '@/types'
import { ConflictBanner } from '../ConflictBanner'

interface BannerOptions {
  conflicted?: string[]
  operation?: OperationState
}

interface BannerActions {
  abortOperation: ReturnType<typeof vi.fn>
  continueOperation: ReturnType<typeof vi.fn>
}

function Harness(props: { value: WorkingTreeStatus; actions: BannerActions }) {
  const dialogs = useDialogs()
  return (
    <WorkingTreeStatusProvider value={props.value}>
      <ConflictBanner
        onContinue={(noun) => props.actions.continueOperation(noun)}
        onAbort={(summary) =>
          dialogs.confirm({
            title: summary.confirmTitle,
            message: summary.confirmMessage,
            confirmText: summary.abortText,
            destructive: true,
            onConfirm: () => props.actions.abortOperation(summary.noun)
          })
        }
      />
      {dialogs.dialogs}
    </WorkingTreeStatusProvider>
  )
}

function renderBanner(options: BannerOptions = {}) {
  const conflicted = options.conflicted ?? []
  const status: GitStatus = {
    current: 'main',
    modified: [],
    staged: [],
    not_added: [],
    conflicted,
    deleted: [],
    created: [],
    renamed: [],
    files: conflicted.map((path) => ({ path, index: 'U', working_dir: 'U' })),
    operation: options.operation
  }
  const value: WorkingTreeStatus = {
    status,
    rows: [],
    statusState: 'ready',
    statusLoading: false,
    stageFile: vi.fn(),
    unstageFile: vi.fn(),
    stageAll: vi.fn(),
    unstageAll: vi.fn(),
    stageHunk: vi.fn(),
    unstageHunk: vi.fn()
  }
  const actions: BannerActions = {
    abortOperation: vi.fn().mockResolvedValue(true),
    continueOperation: vi.fn().mockResolvedValue(true)
  }
  render(<Harness value={value} actions={actions} />)
  return actions
}

const operation = (overrides: Partial<OperationState> = {}): OperationState => ({
  kind: 'merge',
  oursLabel: 'main',
  theirsLabel: 'feature/login',
  ...overrides
})

const banner = () => screen.getByRole('status')

describe('ConflictBanner — operation titles', () => {
  it('names a merge with both refs', () => {
    renderBanner({ conflicted: ['a.ts'], operation: operation({ kind: 'merge' }) })
    expect(banner()).toHaveTextContent('Merging feature/login into main')
  })

  it('names a rebase with both refs', () => {
    renderBanner({ conflicted: ['a.ts'], operation: operation({ kind: 'rebase-merge' }) })
    expect(banner()).toHaveTextContent('Rebasing feature/login onto main')
  })

  it('names the rebase-apply backend as a rebase too', () => {
    renderBanner({ conflicted: ['a.ts'], operation: operation({ kind: 'rebase-apply' }) })
    expect(banner()).toHaveTextContent('Rebasing feature/login onto main')
  })

  it('names a cherry-pick with the picked ref', () => {
    renderBanner({ conflicted: ['a.ts'], operation: operation({ kind: 'cherry-pick' }) })
    expect(banner()).toHaveTextContent('Cherry-picking feature/login')
  })

  it('names a revert with the revert being applied', () => {
    renderBanner({
      conflicted: ['a.ts'],
      operation: operation({ kind: 'revert', theirsLabel: 'revert of 1a2b3c4 add the widget' })
    })
    expect(banner()).toHaveTextContent('Applying revert of 1a2b3c4 add the widget')
  })

  it('names an am run without ref labels', () => {
    renderBanner({ conflicted: ['a.ts'], operation: operation({ kind: 'am' }) })
    expect(banner()).toHaveTextContent('Applying patches')
  })

  it('shows sequence progress when the sidecar reports it', () => {
    renderBanner({
      conflicted: ['a.ts'],
      operation: operation({ kind: 'rebase-merge', done: 2, total: 5 })
    })
    expect(banner()).toHaveTextContent('2/5')
  })

  it('omits progress when the sidecar reports none', () => {
    renderBanner({ conflicted: ['a.ts'], operation: operation({ kind: 'cherry-pick' }) })
    expect(banner().textContent).not.toMatch(/\d+\/\d+/)
  })
})

describe('ConflictBanner — continue', () => {
  it('offers Continue for a rebase', () => {
    renderBanner({ operation: operation({ kind: 'rebase-merge' }) })
    expect(screen.getByRole('button', { name: 'Continue rebase' })).toBeEnabled()
  })

  it('disables Continue while conflicts remain and says why', () => {
    renderBanner({ conflicted: ['a.ts'], operation: operation({ kind: 'cherry-pick' }) })

    expect(screen.getByRole('button', { name: 'Continue cherry-pick' })).toBeDisabled()
    expect(banner()).toHaveTextContent('Resolve and stage every file before you continue')
  })

  it('continues the operation when clicked', () => {
    const actions = renderBanner({ operation: operation({ kind: 'revert' }) })

    fireEvent.click(screen.getByRole('button', { name: 'Continue revert' }))
    expect(actions.continueOperation).toHaveBeenCalledWith('revert')
  })

  it('offers no Continue for a merge, pointing at the commit box instead', () => {
    renderBanner({ operation: operation({ kind: 'merge' }) })

    expect(screen.queryByRole('button', { name: /^Continue/ })).not.toBeInTheDocument()
    expect(banner()).toHaveTextContent('Finish this merge from the commit box below.')
  })
})

describe('ConflictBanner — abort', () => {
  it('aborts only after the confirmation is accepted', () => {
    const actions = renderBanner({
      conflicted: ['a.ts'],
      operation: operation({ kind: 'rebase-merge' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Abort rebase' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Abort this rebase?')
    expect(dialog).toHaveTextContent('state it was in before the rebase started')
    expect(actions.abortOperation).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Abort rebase' }))
    expect(actions.abortOperation).toHaveBeenCalledWith('rebase')
  })

  it('does not abort when the confirmation is cancelled', () => {
    const actions = renderBanner({
      conflicted: ['a.ts'],
      operation: operation({ kind: 'merge' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Abort merge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(actions.abortOperation).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ConflictBanner — visibility', () => {
  it('stays visible with an operation in progress and every conflict resolved', () => {
    renderBanner({ conflicted: [], operation: operation({ kind: 'rebase-merge' }) })

    expect(banner()).toHaveTextContent('Rebasing feature/login onto main')
    expect(banner()).toHaveTextContent('All conflicts are resolved')
  })

  it('does not call an am patch series resolved when nothing is marked conflicted', () => {
    renderBanner({ conflicted: [], operation: operation({ kind: 'am' }) })

    expect(banner()).toHaveTextContent('leaves nothing marked conflicted')
    expect(banner()).toHaveTextContent('Edit the affected files and stage them')
    expect(banner()).not.toHaveTextContent('All conflicts are resolved')
  })

  it('points a finished merge at the commit box', () => {
    renderBanner({ conflicted: [], operation: operation({ kind: 'merge' }) })
    expect(banner()).toHaveTextContent('All conflicts are resolved')
  })

  it('renders nothing with no conflicts and no operation', () => {
    renderBanner({ conflicted: [] })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('ConflictBanner — legacy fallback (conflicts without an operation)', () => {
  it('describes a single conflict in the singular', () => {
    renderBanner({ conflicted: ['src/conflict.ts'] })

    expect(banner()).toHaveTextContent('1 merge conflict')
    expect(banner()).toHaveTextContent('Resolve the file, then stage it to continue')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('agrees in number with the conflict count', () => {
    renderBanner({ conflicted: ['src/one.ts', 'src/two.ts'] })

    expect(banner()).toHaveTextContent('2 merge conflicts')
    expect(banner()).toHaveTextContent('Resolve the files, then stage them to continue')
  })
})
