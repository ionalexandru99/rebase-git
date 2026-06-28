import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RefTreePanel } from '../RefTreePanel'

function renderPanel(overrides: Partial<Parameters<typeof RefTreePanel>[0]> = {}) {
  return render(
    <RefTreePanel
      localBranches={['main', 'feature/login']}
      remoteBranches={[]}
      tags={[]}
      currentBranch="main"
      {...overrides}
    />
  )
}

describe('RefTreePanel filter input', () => {
  it('always renders the filter input', async () => {
    renderPanel()
    expect(await screen.findByRole('searchbox', { name: 'Filter refs' })).toBeInTheDocument()
  })

  it('narrows the rendered rows as the user types', async () => {
    renderPanel({ localBranches: ['main', 'develop'] })
    expect(screen.getByTitle('develop')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter refs' }), {
      target: { value: 'main' }
    })
    await waitFor(() => {
      expect(screen.queryByTitle('develop')).not.toBeInTheDocument()
    })
    expect(screen.getByTitle('main')).toBeInTheDocument()
  })

  it('shows a clear button only when the query is non-empty and clears on click', async () => {
    renderPanel({ localBranches: ['main', 'develop'] })
    const input = screen.getByRole('searchbox', { name: 'Filter refs' })
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'main' } })
    await waitFor(() => expect(screen.queryByTitle('develop')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(input).toHaveValue('')
    await waitFor(() => expect(screen.getByTitle('develop')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument()
  })

  it('clears the query when Escape is pressed in the input', async () => {
    renderPanel({ localBranches: ['main', 'develop'] })
    const input = screen.getByRole('searchbox', { name: 'Filter refs' })
    fireEvent.change(input, { target: { value: 'main' } })
    await waitFor(() => expect(screen.queryByTitle('develop')).not.toBeInTheDocument())

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('')
    await waitFor(() => expect(screen.getByTitle('develop')).toBeInTheDocument())
  })

  it('keeps the query ephemeral: resets on remount and is never persisted', async () => {
    const { rerender } = render(
      <RefTreePanel
        key="repo-a"
        localBranches={['main', 'develop']}
        remoteBranches={[]}
        tags={[]}
        currentBranch="main"
      />
    )
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter refs' }), {
      target: { value: 'main' }
    })
    await waitFor(() => expect(screen.queryByTitle('develop')).not.toBeInTheDocument())
    expect(vi.mocked(window.electronAPI.setRefTreeToggles)).not.toHaveBeenCalled()

    rerender(
      <RefTreePanel
        key="repo-b"
        localBranches={['main', 'develop']}
        remoteBranches={[]}
        tags={[]}
        currentBranch="main"
      />
    )
    await waitFor(() => expect(screen.getByTitle('develop')).toBeInTheDocument())
    expect(screen.getByRole('searchbox', { name: 'Filter refs' })).toHaveValue('')
  })
})
