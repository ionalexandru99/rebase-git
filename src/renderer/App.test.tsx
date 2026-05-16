import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import App from '@/App'

function mockBaseAPI(
  overrides: Partial<{
    onboardingComplete: boolean | null
    workingDirectory: string | null
    recentRepos: string[]
    scanRepos: string[]
  }> = {}
) {
  vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(
    overrides.onboardingComplete ?? true
  )
  vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue(
    overrides.workingDirectory ?? null
  )
  vi.mocked(window.electronAPI.getRecentRepos).mockResolvedValue(overrides.recentRepos ?? [])
  vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
    success: true,
    repos: overrides.scanRepos ?? []
  })
}

describe('App — onboarding gate', () => {
  it('shows a loading state while checking onboarding status', () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockReturnValue(new Promise(() => {}))
    vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue(null)
    vi.mocked(window.electronAPI.getRecentRepos).mockResolvedValue([])

    render(<App />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders the onboarding screen when onboarding is not complete', async () => {
    mockBaseAPI({ onboardingComplete: false })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Welcome to Rebase')).toBeInTheDocument()
    })
  })
})

describe('App — repo picker (no repo open)', () => {
  it('shows the open-repo empty state with two Open Repository buttons', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/repos' })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Open a Repository')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /Open Repository/i })).toHaveLength(2)
    })
  })

  it('lists workspace repos discovered by scanForRepos', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/repos',
      scanRepos: ['/home/user/repos/my-app']
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Repositories in workspace')).toBeInTheDocument()
      expect(screen.getByText('/home/user/repos/my-app')).toBeInTheDocument()
    })
  })

  it('lists recent repos from settings', async () => {
    mockBaseAPI({ recentRepos: ['/recent/repo'] })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Recent')).toBeInTheDocument()
      expect(screen.getByText('/recent/repo')).toBeInTheDocument()
    })
  })

  it('does not show repo lists when both sources are empty', async () => {
    mockBaseAPI()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Open a Repository')).toBeInTheDocument()
    })

    expect(screen.queryByText('Repositories in workspace')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
  })

  it('opens a repo when a discovered workspace entry is clicked', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/repos',
      scanRepos: ['/home/user/repos/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      success: true,
      path: '/home/user/repos/my-app',
      status: { current: 'main', modified: [], staged: [], not_added: [] },
      log: { all: [], total: 0 },
      branches: { current: 'main', all: ['main'] }
    })

    render(<App />)

    const repoEntry = await screen.findByText('/home/user/repos/my-app')
    fireEvent.click(repoEntry)

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/repos/my-app')
    })
  })
})

describe('App — workspace (repo open)', () => {
  const openRepoMock = {
    success: true,
    path: '/home/user/projects/my-app',
    status: {
      current: 'feature/ui',
      modified: ['src/a.ts'],
      staged: ['src/b.ts', 'src/c.ts'],
      not_added: ['new.ts']
    },
    log: {
      all: [
        {
          hash: '1234567abc',
          message: 'Initial commit',
          author_name: 'Jane Doe',
          date: new Date().toISOString()
        }
      ],
      total: 1
    },
    branches: { current: 'feature/ui', all: ['main', 'feature/ui'] }
  }

  async function renderWithRepo() {
    mockBaseAPI()
    vi.mocked(window.electronAPI.selectFolder).mockResolvedValue('/home/user/projects/my-app')
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)

    render(<App />)

    // Two "Open Repository" buttons exist on the empty state (header + hero) — click either.
    const buttons = await screen.findAllByRole('button', { name: /Open Repository/i })
    fireEvent.click(buttons[0])

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalled()
    })
  }

  it('renders the repo dashboard with name, branch, and change counts', async () => {
    await renderWithRepo()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'my-app' })).toBeInTheDocument()
    })

    // Branch name appears in both the header chip and the dashboard stat card.
    expect(screen.getAllByText('feature/ui').length).toBeGreaterThanOrEqual(1)
    // 1 modified + 2 staged + 1 untracked = 4 changes
    expect(screen.getByText(/4 changes/)).toBeInTheDocument()
  })

  it('renders the working directory and history panels', async () => {
    await renderWithRepo()

    expect(await screen.findByText('Working Directory')).toBeInTheDocument()
    expect(screen.getByText('Commit')).toBeInTheDocument()
    expect(screen.getByText('Commit History')).toBeInTheDocument()
    expect(screen.getByText('Initial commit')).toBeInTheDocument()
  })

  it('switches the header CTA to "Switch Repo" once a repo is open', async () => {
    await renderWithRepo()

    expect(await screen.findByRole('button', { name: /Switch Repo/i })).toBeInTheDocument()
  })

  it('shows the clean badge when no changes are pending', async () => {
    mockBaseAPI()
    vi.mocked(window.electronAPI.selectFolder).mockResolvedValue('/clean/repo')
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      success: true,
      path: '/clean/repo',
      status: { current: 'main', modified: [], staged: [], not_added: [] },
      log: { all: [], total: 0 },
      branches: { current: 'main', all: ['main'] }
    })

    render(<App />)
    const buttons = await screen.findAllByRole('button', { name: /Open Repository/i })
    fireEvent.click(buttons[0])

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'repo' })).toBeInTheDocument()
    })
    // Clean badge appears in the dashboard once a clean repo is open.
    expect(screen.getAllByText('Clean').length).toBeGreaterThanOrEqual(1)
  })

  it('shows a banner when an openRepo error happens', async () => {
    mockBaseAPI()
    vi.mocked(window.electronAPI.selectFolder).mockResolvedValue('/bad/repo')
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      success: false,
      error: 'Not a git repository'
    })

    render(<App />)
    const buttons = await screen.findAllByRole('button', { name: /Open Repository/i })
    fireEvent.click(buttons[0])

    await waitFor(() => {
      expect(screen.getByText('Not a git repository')).toBeInTheDocument()
    })
  })
})
