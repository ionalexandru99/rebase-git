import type { OperationState } from '@shared/schemas/git'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CleanWorkingTree } from '../CleanWorkingTree'

const operation = (overrides: Partial<OperationState> = {}): OperationState => ({
  kind: 'merge',
  oursLabel: 'main',
  theirsLabel: 'feature',
  ...overrides
})

describe('CleanWorkingTree', () => {
  it('calls the tree clean when nothing is in progress', () => {
    render(<CleanWorkingTree />)

    expect(screen.getByText('Working tree clean')).toBeInTheDocument()
    expect(screen.getByText('Nothing to commit — every change is on a branch.')).toBeInTheDocument()
  })

  it('does not claim there is nothing to commit while a merge is in progress', () => {
    render(<CleanWorkingTree operation={operation({ kind: 'merge' })} />)

    expect(screen.queryByText(/Nothing to commit/)).not.toBeInTheDocument()
    expect(screen.getByText(/the merge is still in progress/)).toBeInTheDocument()
    expect(screen.getByText(/working tree matches HEAD/)).toBeInTheDocument()
  })

  it('names the operation still in progress', () => {
    render(<CleanWorkingTree operation={operation({ kind: 'rebase-merge' })} />)
    expect(screen.getByText(/the rebase is still in progress/)).toBeInTheDocument()
  })

  it('points at the controls that end the operation', () => {
    render(<CleanWorkingTree operation={operation({ kind: 'cherry-pick' })} />)
    expect(screen.getByText(/finish or abort it above/)).toBeInTheDocument()
  })
})
