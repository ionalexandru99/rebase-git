import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RefTreePanel } from '../RefTreePanel'

function renderPanel(overrides: Partial<Parameters<typeof RefTreePanel>[0]> = {}) {
  return render(
    <RefTreePanel
      localBranches={['main', 'feature/login']}
      remoteBranches={[]}
      tags={[]}
      currentBranch="main"
      repoPath="/repo-a"
      {...overrides}
    />
  )
}

describe('RefTreePanel filter input', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([])
    vi.mocked(window.electronAPI.setRefTreeToggles).mockClear()
  })
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
        repoPath="/repo-a"
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
        repoPath="/repo-b"
      />
    )
    await waitFor(() => expect(screen.getByTitle('develop')).toBeInTheDocument())
    expect(screen.getByRole('searchbox', { name: 'Filter refs' })).toHaveValue('')
  })

  it('restores expansion only for the matching repository', async () => {
    vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([
      'repo:%2Frepo-a:folder:local:feature'
    ])
    const first = renderPanel({ repoPath: '/repo-a' })

    expect(await screen.findByTitle('feature/login')).toBeInTheDocument()
    first.unmount()
    renderPanel({ repoPath: '/repo-b' })

    expect(await screen.findByTitle('feature')).toBeInTheDocument()
    expect(screen.queryByTitle('feature/login')).not.toBeInTheDocument()
  })

  it('persists one scoped expansion outside StrictMode state updaters', async () => {
    render(
      <StrictMode>
        <RefTreePanel
          repoPath="/repo-a"
          localBranches={['main', 'feature/login']}
          remoteBranches={[]}
          tags={[]}
          currentBranch="main"
        />
      </StrictMode>
    )
    const folder = await screen.findByTitle('feature')

    fireEvent.click(folder)

    await waitFor(() => {
      expect(window.electronAPI.setRefTreeToggles).toHaveBeenCalledTimes(1)
    })
    expect(window.electronAPI.setRefTreeToggles).toHaveBeenCalledWith([
      'repo:%2Frepo-a:folder:local:feature'
    ])
  })

  it('merges simultaneous expansion writes from different repositories', async () => {
    let stored: string[] = []
    vi.mocked(window.electronAPI.getRefTreeToggles).mockImplementation(async () => [...stored])
    vi.mocked(window.electronAPI.setRefTreeToggles).mockImplementation(async (toggles) => {
      stored = [...toggles]
    })
    const repoA = renderPanel({ repoPath: '/repo-a' })
    const repoB = renderPanel({ repoPath: '/repo-b' })
    await waitFor(() => expect(window.electronAPI.getRefTreeToggles).toHaveBeenCalledTimes(2))

    fireEvent.click(within(repoA.container).getByTitle('feature'))
    fireEvent.click(within(repoB.container).getByTitle('feature'))

    await waitFor(() => expect(window.electronAPI.setRefTreeToggles).toHaveBeenCalledTimes(2))
    expect(stored).toEqual([
      'repo:%2Frepo-a:folder:local:feature',
      'repo:%2Frepo-b:folder:local:feature'
    ])
  })
})
