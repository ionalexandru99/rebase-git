import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PushOutcome } from '@/stores/action-runner'
import { ListColumnHeader } from '../ListColumnHeader'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

function renderHeader(overrides: Partial<Parameters<typeof ListColumnHeader>[0]> = {}) {
  const onFetch = vi.fn()
  const onResetLayout = vi.fn()
  const onCopyRepoPath = vi.fn()
  const onFilterChange = vi.fn()
  render(
    <ListColumnHeader
      repoName={overrides.repoName ?? 'acme'}
      loadedCount={overrides.loadedCount ?? 2}
      visibleTotal={overrides.visibleTotal ?? 2}
      visibleBranchCount={overrides.visibleBranchCount ?? 1}
      hasMore={overrides.hasMore}
      loading={overrides.loading}
      filter={overrides.filter ?? ''}
      onFilterChange={overrides.onFilterChange ?? onFilterChange}
      branchName={overrides.branchName ?? 'main'}
      ahead={overrides.ahead ?? 0}
      behind={overrides.behind ?? 0}
      detached={overrides.detached ?? false}
      syncing={overrides.syncing ?? false}
      busy={overrides.busy}
      onFetch={overrides.onFetch ?? onFetch}
      onPull={overrides.onPull ?? vi.fn(async () => true)}
      push={overrides.push ?? vi.fn(async () => ({ kind: 'ok' }) as PushOutcome)}
      onResetLayout={overrides.onResetLayout ?? onResetLayout}
      onCopyRepoPath={overrides.onCopyRepoPath ?? onCopyRepoPath}
    />
  )
  return { onFetch, onResetLayout, onCopyRepoPath, onFilterChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ListColumnHeader', () => {
  it('names the repo and how many commits the timeline is showing', () => {
    renderHeader({ repoName: 'acme', loadedCount: 3, visibleTotal: 3, visibleBranchCount: 2 })

    expect(screen.getByText('acme')).toBeInTheDocument()
    expect(screen.getByText('3 commits · 2 branches visible')).toBeInTheDocument()
  })

  it('fetches from the header', () => {
    const { onFetch } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))

    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('carries the sync affordance with its ahead and behind counts', () => {
    renderHeader({ ahead: 2, behind: 1 })

    expect(screen.getByTestId('sync-button')).toHaveTextContent('Sync')
    expect(screen.getByTestId('sync-button')).toHaveTextContent('↓1')
    expect(screen.getByTestId('sync-button')).toHaveTextContent('↑2')
  })

  it('opens the commit filter from a search affordance and keeps its label', () => {
    const { onFilterChange } = renderHeader()
    expect(screen.queryByRole('textbox', { name: 'Filter commits' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Filter commits' }))

    const input = screen.getByRole('textbox', { name: 'Filter commits' })
    fireEvent.change(input, { target: { value: 'fix' } })

    expect(onFilterChange).toHaveBeenCalledWith('fix')
  })

  it('keeps the filter open while it holds a query', () => {
    renderHeader({ filter: 'fix' })

    expect(screen.getByRole('textbox', { name: 'Filter commits' })).toHaveValue('fix')
  })

  it('offers layout reset and repo-path copy from the overflow menu', async () => {
    const { onResetLayout, onCopyRepoPath } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'Repository actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reset layout' }))
    expect(onResetLayout).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Repository actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy repo path' }))
    expect(onCopyRepoPath).toHaveBeenCalledOnce()
  })

  it('parks the command palette behind a disabled control', () => {
    renderHeader()

    const palette = screen.getByRole('button', { name: 'Command palette' })
    expect(palette).toBeDisabled()
    expect(palette).toHaveAttribute('title', 'Coming soon')
  })

  it('stops the remote actions while another repository action is busy', () => {
    renderHeader({ busy: true, ahead: 1 })

    expect(screen.getByRole('button', { name: 'Fetch' })).toBeDisabled()
    expect(screen.getByTestId('sync-button')).toBeDisabled()
  })
})
