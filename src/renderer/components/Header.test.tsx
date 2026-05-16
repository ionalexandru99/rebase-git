import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Header } from '@/components/Header'

describe('Header', () => {
  it('always renders the Rebase brand', () => {
    render(<Header currentBranch="" repoPath={null} onOpenRepo={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Rebase' })).toBeInTheDocument()
  })

  it('shows an Open Repository CTA when no repo is loaded', () => {
    render(<Header currentBranch="" repoPath={null} onOpenRepo={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Open Repository/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch Repo/i })).not.toBeInTheDocument()
  })

  it('shows the repo path and branch chip when a repo is loaded', () => {
    render(
      <Header
        currentBranch="feature/ui"
        repoPath="/home/user/projects/awesome-app"
        onOpenRepo={vi.fn()}
      />
    )

    expect(screen.getByText('awesome-app')).toBeInTheDocument()
    expect(screen.getByText('/home/user/projects/awesome-app')).toBeInTheDocument()
    expect(screen.getByText('feature/ui')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Switch Repo/i })).toBeInTheDocument()
  })

  it('renders a "no-branch" placeholder when branch is empty but repo is open', () => {
    render(<Header currentBranch="" repoPath="/home/user/projects/app" onOpenRepo={vi.fn()} />)

    expect(screen.getByText('no-branch')).toBeInTheDocument()
  })

  it('invokes onOpenRepo when the CTA is clicked', () => {
    const onOpenRepo = vi.fn()
    render(<Header currentBranch="main" repoPath={null} onOpenRepo={onOpenRepo} />)

    fireEvent.click(screen.getByRole('button', { name: /Open Repository/i }))
    expect(onOpenRepo).toHaveBeenCalledTimes(1)
  })
})
