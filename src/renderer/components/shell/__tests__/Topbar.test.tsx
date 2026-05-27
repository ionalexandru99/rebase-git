import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '../../ui/sidebar'
import { Topbar } from '../Topbar'

function renderTopbar(overrides: Partial<Parameters<typeof Topbar>[0]> = {}) {
  return render(
    <SidebarProvider>
      <Topbar
        repoName={overrides.repoName ?? 'my-repo'}
        repoPath={'repoPath' in overrides ? (overrides.repoPath ?? null) : '/home/user/my-repo'}
        branch={overrides.branch ?? 'main'}
        onFetch={overrides.onFetch}
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

  it('does not render Pull or Push (not yet implemented)', () => {
    renderTopbar()
    expect(screen.queryByRole('button', { name: /Pull/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Push/i })).not.toBeInTheDocument()
  })

  it('truncates long branch names', () => {
    renderTopbar({ branch: 'feature/very-long-branch-name' })
    const branchText = screen.getByText('feature/very-long-branch-name')
    expect(branchText.className).toMatch(/truncate/)
  })
})
