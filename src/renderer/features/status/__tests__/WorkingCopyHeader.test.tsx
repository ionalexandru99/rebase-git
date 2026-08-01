import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildUnifiedFileRows } from '@/features/status/status-file-rows'
import { type WorkingTreeStatus, WorkingTreeStatusProvider } from '@/features/status/store'
import { WorkingCopyHeader } from '@/features/status/WorkingCopyHeader'
import type { GitStatus } from '@/types'

type Code = { path: string; index: string; working_dir: string }

const code = (path: string, index: string, working_dir: string): Code => ({
  path,
  index,
  working_dir
})

function statusWith(files: Code[], overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    current: 'main',
    modified: [],
    staged: [],
    not_added: [],
    conflicted: [],
    deleted: [],
    created: [],
    renamed: [],
    files,
    ...overrides
  }
}

function renderHeader(status: GitStatus, stageAll = vi.fn()) {
  const value: WorkingTreeStatus = {
    status,
    rows: buildUnifiedFileRows(status),
    statusState: 'ready',
    statusLoading: false,
    stageFile: vi.fn(),
    unstageFile: vi.fn(),
    stageAll,
    unstageAll: vi.fn(),
    stageHunk: vi.fn(),
    unstageHunk: vi.fn(),
    discardHunk: vi.fn(),
    stageLines: vi.fn(),
    unstageLines: vi.fn()
  }
  render(
    <WorkingTreeStatusProvider value={value}>
      <WorkingCopyHeader />
    </WorkingTreeStatusProvider>
  )
  return { stageAll }
}

const header = () => screen.getByTestId('working-copy-header')

describe('WorkingCopyHeader', () => {
  it('titles the pane Working copy and counts the files and the staged ones', () => {
    renderHeader(
      statusWith([
        code('a.ts', ' ', 'M'),
        code('b.ts', ' ', 'M'),
        code('c.ts', 'M', ' '),
        code('d.ts', '?', '?')
      ])
    )

    expect(header()).toHaveTextContent('Working copy')
    expect(header()).toHaveTextContent('4 files · 1 staged')
  })

  it('agrees in number with a single change', () => {
    renderHeader(statusWith([code('a.ts', 'M', ' ')]))

    expect(header()).toHaveTextContent('1 file · 1 staged')
  })

  it('stages every unstaged file in one call', () => {
    const { stageAll } = renderHeader(
      statusWith([code('a.ts', ' ', 'M'), code('b.ts', '?', '?'), code('c.ts', 'M', ' ')])
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stage all' }))

    expect(stageAll).toHaveBeenCalledTimes(1)
    expect(stageAll).toHaveBeenCalledWith(['a.ts', 'b.ts'])
  })

  it('stages the unstaged half of a partially staged file', () => {
    const { stageAll } = renderHeader(statusWith([code('a.ts', 'M', 'M')]))

    fireEvent.click(screen.getByRole('button', { name: 'Stage all' }))

    expect(stageAll).toHaveBeenCalledWith(['a.ts'])
  })

  it('disables Stage all when everything is already staged', () => {
    renderHeader(statusWith([code('a.ts', 'M', ' ')]))

    expect(screen.getByRole('button', { name: 'Stage all' })).toBeDisabled()
  })

  it('leaves conflicted files out of both the staged count and Stage all', () => {
    const { stageAll } = renderHeader(
      statusWith([code('conflict.ts', 'U', 'U'), code('a.ts', 'M', ' ')], {
        conflicted: ['conflict.ts']
      })
    )

    expect(header()).toHaveTextContent('2 files · 1 staged')
    expect(screen.getByRole('button', { name: 'Stage all' })).toBeDisabled()
    expect(stageAll).not.toHaveBeenCalled()
  })

  it('reports a clean working copy', () => {
    renderHeader(statusWith([]))

    expect(header()).toHaveTextContent('0 files · 0 staged')
    expect(screen.getByRole('button', { name: 'Stage all' })).toBeDisabled()
  })
})
