import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeadCommitFilesGroup } from '../HeadCommitFilesGroup'

describe('HeadCommitFilesGroup', () => {
  it('lists HEAD’s files under a “From last commit” group for a non-merge commit', () => {
    render(
      <HeadCommitFilesGroup
        files={[
          { status: 'M', path: 'src/app.ts' },
          { status: 'A', path: 'src/new.ts' }
        ]}
        parentCount={1}
        selectedFile={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('From last commit')).toBeInTheDocument()
    expect(screen.getByText('src/app.ts')).toBeInTheDocument()
    expect(screen.getByText('src/new.ts')).toBeInTheDocument()
  })

  it('suppresses the group for a merge commit (reword-only)', () => {
    render(
      <HeadCommitFilesGroup
        files={[{ status: 'M', path: 'src/app.ts' }]}
        parentCount={2}
        selectedFile={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.queryByText('From last commit')).not.toBeInTheDocument()
    expect(screen.queryByText('src/app.ts')).not.toBeInTheDocument()
  })

  it('renders the group for a root commit (no parents)', () => {
    render(
      <HeadCommitFilesGroup
        files={[{ status: 'A', path: 'README.md' }]}
        parentCount={0}
        selectedFile={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('From last commit')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('selects a file on click', () => {
    const onSelect = vi.fn()
    render(
      <HeadCommitFilesGroup
        files={[{ status: 'M', path: 'src/app.ts' }]}
        parentCount={1}
        selectedFile={null}
        onSelect={onSelect}
      />
    )

    fireEvent.click(screen.getByText('src/app.ts'))

    expect(onSelect).toHaveBeenCalledWith('src/app.ts')
  })

  it('renders a status badge reflecting each file’s change type', () => {
    render(
      <HeadCommitFilesGroup
        files={[
          { status: 'A', path: 'added.ts' },
          { status: 'M', path: 'modified.ts' },
          { status: 'D', path: 'deleted.ts' },
          { status: 'R100', path: 'renamed.ts' }
        ]}
        parentCount={1}
        selectedFile={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByLabelText('created')).toBeInTheDocument()
    expect(screen.getByLabelText('modified')).toBeInTheDocument()
    expect(screen.getByLabelText('deleted')).toBeInTheDocument()
    expect(screen.getByLabelText('renamed')).toBeInTheDocument()
  })
})
