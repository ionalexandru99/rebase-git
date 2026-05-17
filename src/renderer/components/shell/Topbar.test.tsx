import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Topbar } from '@/components/shell/Topbar'
import { SidebarProvider } from '@/components/ui/sidebar'

function renderTopbar(overrides: Partial<Parameters<typeof Topbar>[0]> = {}) {
  return render(
    <SidebarProvider>
      <Topbar
        repoName={overrides.repoName ?? 'my-repo'}
        repoPath={'repoPath' in overrides ? (overrides.repoPath ?? null) : '/home/user/my-repo'}
        branch={overrides.branch ?? 'main'}
        ahead={overrides.ahead ?? 0}
        behind={overrides.behind ?? 0}
        onFetch={overrides.onFetch}
        onPull={overrides.onPull}
        onPush={overrides.onPush}
      />
    </SidebarProvider>
  )
}

describe('Topbar', () => {
  it('renders the repo name and branch', () => {
    renderTopbar({ repoName: 'acme', branch: 'feature/login' })
    expect(screen.getByText('acme')).toBeInTheDocument()
    expect(screen.getByText('feature/login')).toBeInTheDocument()
  })

  it('shows the first letter of the repo name in the icon', () => {
    renderTopbar({ repoName: 'zebra' })
    expect(screen.getByText('Z')).toBeInTheDocument()
  })

  it('shows the repo path', () => {
    renderTopbar({ repoPath: '/projects/acme' })
    expect(screen.getByText('/projects/acme')).toBeInTheDocument()
  })

  it('hides the repo path when repoPath is null', () => {
    renderTopbar({ repoPath: null })
    expect(screen.queryByText('/home/user/my-repo')).not.toBeInTheDocument()
  })

  it('shows the ahead indicator when ahead > 0', () => {
    renderTopbar({ ahead: 3 })
    expect(screen.getByLabelText('ahead')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows the behind indicator when behind > 0', () => {
    renderTopbar({ behind: 2 })
    expect(screen.getByLabelText('behind')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('hides sync indicators when both are zero', () => {
    renderTopbar({ ahead: 0, behind: 0 })
    expect(screen.queryByLabelText('ahead')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('behind')).not.toBeInTheDocument()
  })

  it('disables the Push button when nothing is ahead', () => {
    renderTopbar({ ahead: 0 })
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled()
  })

  it('enables Push and shows the count when ahead > 0', () => {
    renderTopbar({ ahead: 5 })
    const btn = screen.getByRole('button', { name: 'Push 5' })
    expect(btn).not.toBeDisabled()
  })

  it('renders the repo chip as a non-interactive display, not a button', () => {
    renderTopbar({ repoName: 'acme' })
    expect(screen.queryByRole('button', { name: /repository/i })).not.toBeInTheDocument()
  })

  it('fires onFetch when Fetch is clicked', () => {
    const onFetch = vi.fn()
    renderTopbar({ onFetch })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('fires onPull when Pull is clicked', () => {
    const onPull = vi.fn()
    renderTopbar({ onPull })
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    expect(onPull).toHaveBeenCalledOnce()
  })

  it('fires onPush when Push is clicked and ahead > 0', () => {
    const onPush = vi.fn()
    renderTopbar({ onPush, ahead: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Push 1' }))
    expect(onPush).toHaveBeenCalledOnce()
  })

  it('truncates long branch names', () => {
    renderTopbar({ branch: 'feature/very-long-branch-name' })
    const branchText = screen.getByText('feature/very-long-branch-name')
    expect(branchText.className).toMatch(/truncate/)
  })
})
