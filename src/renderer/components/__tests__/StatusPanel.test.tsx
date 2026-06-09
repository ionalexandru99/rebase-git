import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GitStatus } from '@/types'
import { type SelectedFile, StatusPanel } from '../StatusPanel'

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
  selected?: SelectedFile | null
  onSelect?: (file: string, staged: boolean) => void
  onStage?: (file: string) => void
  onUnstage?: (file: string) => void
  loading?: boolean
}) {
  return render(
    <StatusPanel
      status={props.status}
      selected={props.selected ?? null}
      onSelect={props.onSelect ?? vi.fn()}
      onStage={props.onStage ?? vi.fn()}
      onUnstage={props.onUnstage ?? vi.fn()}
      loading={props.loading ?? false}
    />
  )
}

describe('StatusPanel', () => {
  it('renders nothing when status is null', () => {
    renderPanel({ status: null })
    expect(screen.queryByText('Changes')).not.toBeInTheDocument()
  })

  it('renders the section titles and counts when status has files', () => {
    renderPanel({
      status: emptyStatus({
        modified: ['a.ts', 'b.ts'],
        staged: ['c.ts'],
        not_added: ['d.ts']
      })
    })

    expect(screen.getByText('4 files · 1 staged')).toBeInTheDocument()
    expect(screen.getAllByText('Changes').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Staged')).toBeInTheDocument()
    expect(screen.getByText('Untracked')).toBeInTheDocument()
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('c.ts')).toBeInTheDocument()
    expect(screen.getByText('d.ts')).toBeInTheDocument()
  })

  it('surfaces conflicted files in their own section', () => {
    renderPanel({
      status: emptyStatus({ conflicted: ['merge.ts', 'other.ts'] })
    })

    expect(screen.getByText('Conflicts')).toBeInTheDocument()
    expect(screen.getByText('merge.ts')).toBeInTheDocument()
    expect(screen.getByText('other.ts')).toBeInTheDocument()
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

    expect(screen.getByText('2 files · 2 staged')).toBeInTheDocument()
    expect(screen.getByText('s.ts')).toBeInTheDocument()
    expect(screen.getByText('c.ts')).toBeInTheDocument()
  })

  it('shows a loading badge while loading', () => {
    renderPanel({ status: emptyStatus(), loading: true })

    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('stages a file through its checkbox', () => {
    const onStage = vi.fn()
    renderPanel({
      status: emptyStatus({ modified: ['index.ts'] }),
      onStage
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Stage index.ts' }))
    expect(onStage).toHaveBeenCalledWith('index.ts')
  })

  it('unstages a file through its checkbox', () => {
    const onUnstage = vi.fn()
    renderPanel({
      status: emptyStatus({ staged: ['index.ts'] }),
      onUnstage
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Unstage index.ts' }))
    expect(onUnstage).toHaveBeenCalledWith('index.ts')
  })

  it('selects a file when its row is clicked', () => {
    const onSelect = vi.fn()
    renderPanel({
      status: emptyStatus({ modified: ['index.ts'] }),
      onSelect
    })

    fireEvent.click(screen.getByText('index.ts'))
    expect(onSelect).toHaveBeenCalledWith('index.ts', false)
  })

  it('highlights the selected file row', () => {
    renderPanel({
      status: emptyStatus({ modified: ['index.ts'] }),
      selected: { file: 'index.ts', staged: false }
    })

    const row = screen.getByText('index.ts').closest('[data-testid="status-file-row"]')
    expect(row?.className).toMatch(/brand-soft/)
  })

  it('stages every unstaged file via Stage all', () => {
    const onStage = vi.fn()
    renderPanel({
      status: emptyStatus({ modified: ['a.ts'], not_added: ['b.ts'] }),
      onStage
    })

    fireEvent.click(screen.getByRole('button', { name: 'Stage all' }))
    expect(onStage).toHaveBeenCalledWith('a.ts')
    expect(onStage).toHaveBeenCalledWith('b.ts')
  })

  it('unstages a whole section via the section checkbox', () => {
    const onUnstage = vi.fn()
    renderPanel({
      status: emptyStatus({ staged: ['a.ts', 'b.ts'] }),
      onUnstage
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Unstage all Staged' }))
    expect(onUnstage).toHaveBeenCalledWith('a.ts')
    expect(onUnstage).toHaveBeenCalledWith('b.ts')
  })

  it('truncates long file names and exposes the full path as a title attribute', () => {
    const longPath = 'src/very/deep/nested/path/component.tsx'
    renderPanel({ status: emptyStatus({ modified: [longPath] }) })
    const fileSpan = screen.getByText(longPath)
    expect(fileSpan.className).toMatch(/truncate/)
    expect(fileSpan).toHaveAttribute('title', longPath)
  })
})
