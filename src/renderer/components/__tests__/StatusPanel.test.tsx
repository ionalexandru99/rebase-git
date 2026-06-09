import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

function renderPanel(props: {
  status: GitStatus | null
  selected?: SelectedFile | null
  onSelect?: (file: string) => void
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

  it('selects a file when its row is clicked', () => {
    const onSelect = vi.fn()
    renderPanel({ status: emptyStatus({ files: [code('index.ts', ' ', 'M')] }), onSelect })

    fireEvent.click(screen.getByText('index.ts'))
    expect(onSelect).toHaveBeenCalledWith('index.ts')
  })

  it('highlights the selected file row', () => {
    renderPanel({
      status: emptyStatus({ files: [code('index.ts', ' ', 'M')] }),
      selected: { file: 'index.ts' }
    })

    const row = screen.getByText('index.ts').closest('[data-testid="status-file-row"]')
    expect(row?.className).toMatch(/brand-soft/)
  })

  it('stages every file via the master checkbox', () => {
    const onStage = vi.fn()
    renderPanel({
      status: emptyStatus({ files: [code('a.ts', ' ', 'M'), code('b.ts', '?', '?')] }),
      onStage
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Stage all files' }))
    expect(onStage).toHaveBeenCalledWith('a.ts')
    expect(onStage).toHaveBeenCalledWith('b.ts')
  })

  it('unstages everything via the master checkbox when all staged', () => {
    const onUnstage = vi.fn()
    renderPanel({
      status: emptyStatus({ files: [code('a.ts', 'M', ' '), code('b.ts', 'M', ' ')] }),
      onUnstage
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Unstage all files' }))
    expect(onUnstage).toHaveBeenCalledWith('a.ts')
    expect(onUnstage).toHaveBeenCalledWith('b.ts')
  })

  it('truncates long file names and exposes the full path as a title attribute', () => {
    const longPath = 'src/very/deep/nested/path/component.tsx'
    renderPanel({ status: emptyStatus({ files: [code(longPath, ' ', 'M')] }) })
    const fileSpan = screen.getByText(longPath)
    expect(fileSpan.className).toMatch(/truncate/)
    expect(fileSpan).toHaveAttribute('title', longPath)
  })
})
