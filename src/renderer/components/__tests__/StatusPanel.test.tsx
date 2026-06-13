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
  onStageAll?: (files: string[]) => void
  onUnstageAll?: (files: string[]) => void
  loading?: boolean
}) {
  return render(
    <StatusPanel
      status={props.status}
      selected={props.selected ?? null}
      onSelect={props.onSelect ?? vi.fn()}
      onStage={props.onStage ?? vi.fn()}
      onUnstage={props.onUnstage ?? vi.fn()}
      onStageAll={props.onStageAll ?? vi.fn()}
      onUnstageAll={props.onUnstageAll ?? vi.fn()}
      loading={props.loading ?? false}
    />
  )
}

describe('StatusPanel', () => {
  it('renders nothing when status is null', () => {
    renderPanel({ status: null })
    expect(screen.queryByText('Changes')).not.toBeInTheDocument()
  })

  it('fires file actions from the row context menu', async () => {
    const onFileAction = vi.fn()
    render(
      <StatusPanel
        status={emptyStatus({ files: [code('a.ts', ' ', 'M')] })}
        selected={null}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
        onFileAction={onFileAction}
        loading={false}
      />
    )
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

  it('truncates long file names and exposes the full path as a title attribute', () => {
    const longPath = 'src/very/deep/nested/path/component.tsx'
    renderPanel({ status: emptyStatus({ files: [code(longPath, ' ', 'M')] }) })
    const fileSpan = screen.getByText(longPath)
    expect(fileSpan.className).toMatch(/truncate/)
    expect(fileSpan).toHaveAttribute('title', longPath)
  })
})
