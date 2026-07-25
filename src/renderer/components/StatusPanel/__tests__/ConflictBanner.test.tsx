import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type WorkingTreeStatus, WorkingTreeStatusProvider } from '@/stores/working-tree-status'
import type { GitStatus } from '@/types'
import { ConflictBanner } from '../ConflictBanner'

function renderBanner(conflicted: string[]) {
  const status: GitStatus = {
    current: 'main',
    modified: [],
    staged: [],
    not_added: [],
    conflicted,
    deleted: [],
    created: [],
    renamed: [],
    files: conflicted.map((path) => ({ path, index: 'U', working_dir: 'U' }))
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
  return render(
    <WorkingTreeStatusProvider value={value}>
      <ConflictBanner />
    </WorkingTreeStatusProvider>
  )
}

describe('ConflictBanner', () => {
  it('renders nothing when no file is conflicted', () => {
    renderBanner([])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('describes a single conflict in the singular', () => {
    renderBanner(['src/conflict.ts'])

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('1 merge conflict')
    expect(banner).toHaveTextContent('Resolve the file, then stage it to continue')
  })

  it('agrees in number with the conflict count', () => {
    renderBanner(['src/one.ts', 'src/two.ts'])

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('2 merge conflicts')
    expect(banner).toHaveTextContent('Resolve the files, then stage them to continue')
  })
})
