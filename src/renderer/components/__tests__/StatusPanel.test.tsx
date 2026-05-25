import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { GitStatus } from '@/types'
import { StatusPanel } from '../StatusPanel'

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
    ...overrides
  }
}

function renderPanel(props: {
  status: GitStatus | null
  onStage?: (file: string) => void
  onUnstage?: (file: string) => void
  loading?: boolean
}) {
  return render(() => (
    <StatusPanel
      status={props.status}
      onStage={props.onStage ?? vi.fn()}
      onUnstage={props.onUnstage ?? vi.fn()}
      loading={props.loading ?? false}
    />
  ))
}

describe('StatusPanel', () => {
  it('renders nothing when status is null', () => {
    renderPanel({ status: null })
    expect(screen.queryByText('Working Directory')).not.toBeInTheDocument()
  })

  it('renders the section titles and counts when status has files', () => {
    renderPanel({
      status: emptyStatus({
        modified: ['a.ts', 'b.ts'],
        staged: ['c.ts'],
        not_added: ['d.ts']
      })
    })

    expect(screen.getByText('Working Directory')).toBeInTheDocument()
    expect(screen.getByText(/4 pending changes/)).toBeInTheDocument()
    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('Staged')).toBeInTheDocument()
    expect(screen.getByText('Untracked')).toBeInTheDocument()
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('c.ts')).toBeInTheDocument()
    expect(screen.getByText('d.ts')).toBeInTheDocument()
  })

  it('surfaces conflicted files in their own section with a destructive badge', () => {
    renderPanel({
      status: emptyStatus({ conflicted: ['merge.ts', 'other.ts'] })
    })

    expect(screen.getByText('Conflicted')).toBeInTheDocument()
    expect(screen.getByText('merge.ts')).toBeInTheDocument()
    expect(screen.getByText('other.ts')).toBeInTheDocument()
    expect(screen.getByText('2 conflicts')).toBeInTheDocument()
  })

  it('uses singular copy for a single conflict', () => {
    renderPanel({ status: emptyStatus({ conflicted: ['merge.ts'] }) })
    expect(screen.getByText('1 conflict')).toBeInTheDocument()
  })

  it('renders deleted files in the Changes section with a D badge', () => {
    renderPanel({
      status: emptyStatus({ deleted: ['gone.ts'] })
    })

    expect(screen.getByText('gone.ts')).toBeInTheDocument()
    expect(screen.getAllByLabelText('deleted').length).toBeGreaterThanOrEqual(1)
  })

  it('renders renamed files as "from → to"', () => {
    renderPanel({
      status: emptyStatus({ renamed: [{ from: 'old.ts', to: 'new.ts' }] })
    })

    expect(screen.getByText('old.ts → new.ts')).toBeInTheDocument()
    expect(screen.getByLabelText('renamed')).toBeInTheDocument()
  })

  it('counts created files alongside staged ones', () => {
    renderPanel({
      status: emptyStatus({ staged: ['s.ts'], created: ['c.ts'] })
    })

    expect(screen.getAllByText(/Staged/i)[0]).toBeInTheDocument()
    expect(screen.getByText('s.ts')).toBeInTheDocument()
    expect(screen.getByText('c.ts')).toBeInTheDocument()
  })

  it('shows the clean badge and empty placeholders when nothing has changed', () => {
    renderPanel({ status: emptyStatus() })

    expect(screen.getByText('Clean working tree')).toBeInTheDocument()
    expect(screen.getByText('Clean')).toBeInTheDocument()
    expect(screen.getByText('Staged')).toBeInTheDocument()
    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('Untracked')).toBeInTheDocument()
  })

  it('shows a loading badge when loading and hides the clean badge', () => {
    renderPanel({ status: emptyStatus(), loading: true })

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByText('Clean')).not.toBeInTheDocument()
  })

  it('invokes onStage when the Stage button is clicked', () => {
    const onStage = vi.fn()
    renderPanel({
      status: emptyStatus({ modified: ['index.ts'] }),
      onStage
    })

    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    expect(onStage).toHaveBeenCalledWith('index.ts')
  })

  it('invokes onUnstage when the Unstage button is clicked', () => {
    const onUnstage = vi.fn()
    renderPanel({
      status: emptyStatus({ staged: ['index.ts'] }),
      onUnstage
    })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage' }))
    expect(onUnstage).toHaveBeenCalledWith('index.ts')
  })

  it('shows singular pending-change copy', () => {
    renderPanel({ status: emptyStatus({ modified: ['a.ts'] }) })

    expect(screen.getByText('1 pending change')).toBeInTheDocument()
  })

  it('truncates long file names and exposes the full path as a title attribute', () => {
    const longPath = 'src/very/deep/nested/path/component.tsx'
    renderPanel({ status: emptyStatus({ modified: [longPath] }) })
    const fileSpan = screen.getByText(longPath)
    expect(fileSpan.className).toMatch(/truncate/)
    expect(fileSpan).toHaveAttribute('title', longPath)
  })
})
