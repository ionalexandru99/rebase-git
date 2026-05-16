import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import App from '@/App'

function mockBaseAPI(
  overrides: Partial<{
    onboardingComplete: boolean | null
    workingDirectory: string | null
    recentRepos: string[]
    scanRepos: string[]
    workspaces: string[]
  }> = {}
) {
  const workspaces =
    overrides.workspaces ?? (overrides.workingDirectory ? [overrides.workingDirectory] : [])
  const active = overrides.workingDirectory ?? workspaces[0] ?? null

  vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(
    overrides.onboardingComplete ?? true
  )
  vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue(active)
  vi.mocked(window.electronAPI.getWorkspaces).mockResolvedValue(workspaces)
  vi.mocked(window.electronAPI.getActiveWorkspace).mockResolvedValue(active)
  vi.mocked(window.electronAPI.addWorkspace).mockImplementation(async (p) => [...workspaces, p])
  vi.mocked(window.electronAPI.removeWorkspace).mockImplementation(async (p) =>
    workspaces.filter((w) => w !== p)
  )
  vi.mocked(window.electronAPI.setActiveWorkspace).mockResolvedValue(undefined)
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

describe('App — tab shell', () => {
  it('renders the Rebase brand in the tab bar after onboarding', async () => {
    mockBaseAPI()

    render(<App />)

    await waitFor(() => {
      // Brand lives in the TabBar now.
      expect(screen.getByText('Rebase')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Open new tab/i })).toBeInTheDocument()
  })

  it('starts with a single empty tab that shows the repo picker', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/repos' })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Open a Repository')).toBeInTheDocument()
    })
    // Only one Open Repository CTA now (the in-card one) — the per-tab toolbar
    // for the empty state has no separate button.
    expect(screen.getAllByRole('button', { name: /Open Repository/i })).toHaveLength(1)
  })

  it('clicking "New tab" adds a tab and switches to it', async () => {
    mockBaseAPI()

    render(<App />)

    await screen.findByRole('button', { name: /Open new tab/i })
    expect(screen.getAllByRole('tab')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))

    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('closes a tab when its close button is clicked', async () => {
    mockBaseAPI()

    render(<App />)

    await screen.findByRole('button', { name: /Open new tab/i })
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    const closeButtons = screen.getAllByRole('button', { name: /Close tab/i })
    fireEvent.click(closeButtons[0])

    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('does not allow closing the last remaining tab', async () => {
    mockBaseAPI()

    render(<App />)

    await screen.findByRole('button', { name: /Open new tab/i })
    // Only one tab exists, so no close button should be rendered.
    expect(screen.queryAllByRole('button', { name: /Close tab/i })).toHaveLength(0)
  })
})

describe('App — repo picker (no repo open)', () => {
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

    const openButton = await screen.findByRole('button', { name: /Open Repository/i })
    fireEvent.click(openButton)

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalled()
    })
  }

  it('renders the repo dashboard with name, branch, and change counts', async () => {
    await renderWithRepo()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'my-app' })).toBeInTheDocument()
    })

    // Branch appears in the workspace toolbar.
    expect(screen.getByText('feature/ui')).toBeInTheDocument()
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

  it('shows a "Switch Repo" button on the workspace toolbar', async () => {
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
    const openButton = await screen.findByRole('button', { name: /Open Repository/i })
    fireEvent.click(openButton)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'repo' })).toBeInTheDocument()
    })
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
    const openButton = await screen.findByRole('button', { name: /Open Repository/i })
    fireEvent.click(openButton)

    await waitFor(() => {
      expect(screen.getByText('Not a git repository')).toBeInTheDocument()
    })
  })
})
