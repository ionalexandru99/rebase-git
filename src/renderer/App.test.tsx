import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
      expect(screen.getByText('Open a repository')).toBeInTheDocument()
    })
    // Search input is the only entry point; repos are picked from workspace/recents.
    expect(screen.getByRole('searchbox', { name: /Search repositories/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open from disk/i })).not.toBeInTheDocument()
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
      expect(screen.getByText('Workspace')).toBeInTheDocument()
      expect(screen.getByText('/home/user/repos/my-app')).toBeInTheDocument()
    })
  })

  it('lists recent repos from settings once a workspace exists', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/repos',
      recentRepos: ['/recent/repo']
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Recent')).toBeInTheDocument()
      expect(screen.getByText('/recent/repo')).toBeInTheDocument()
    })
  })

  it('shows the add-workspace hint when no workspace has been configured', async () => {
    mockBaseAPI()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Add a workspace')).toBeInTheDocument()
    })

    // No grouped lists or search bar until a workspace exists — only the add-workspace CTA.
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add workspace/i })).toBeInTheDocument()
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

  it('filters both workspace and recent rows as the user types in the search box', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/repos',
      scanRepos: ['/home/user/repos/my-app', '/home/user/repos/other-thing'],
      recentRepos: ['/recent/cool-repo', '/recent/something-else']
    })

    render(<App />)

    await screen.findByText('/home/user/repos/my-app')
    expect(screen.getByText('/home/user/repos/other-thing')).toBeInTheDocument()
    expect(screen.getByText('/recent/cool-repo')).toBeInTheDocument()
    expect(screen.getByText('/recent/something-else')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: /Search repositories/i }), {
      target: { value: 'cool' }
    })

    expect(screen.getByText('/recent/cool-repo')).toBeInTheDocument()
    expect(screen.queryByText('/home/user/repos/my-app')).not.toBeInTheDocument()
    expect(screen.queryByText('/home/user/repos/other-thing')).not.toBeInTheDocument()
    expect(screen.queryByText('/recent/something-else')).not.toBeInTheDocument()
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
          date: new Date().toISOString(),
          parents: [],
          refs: 'HEAD -> feature/ui'
        }
      ],
      total: 1
    },
    branches: { current: 'feature/ui', all: ['main', 'feature/ui'] }
  }

  async function renderWithRepo() {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)

    render(<App />)

    const repoRow = await screen.findByText('/home/user/projects/my-app')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/my-app')
    })
  }

  it('renders the repo dashboard with name, branch, and change counts', async () => {
    await renderWithRepo()

    // Repo name lives in both the tab title and the shell topbar.
    await waitFor(() => {
      expect(screen.getAllByText('my-app').length).toBeGreaterThanOrEqual(1)
    })

    // Branch chip + statusbar pip both reference the branch.
    expect(screen.getAllByText('feature/ui').length).toBeGreaterThanOrEqual(1)
    // 1 modified + 2 staged + 1 untracked = 4 changes — surfaced in the statusbar.
    expect(screen.getByText(/4 changes/)).toBeInTheDocument()
  })

  it('defaults to the history view and swaps to the local-changes view from the sidebar', async () => {
    await renderWithRepo()

    // History is the default view — timeline visible, staging UI mounted but hidden.
    expect(await screen.findByText('Timeline')).toBeVisible()
    expect(screen.getByText('Initial commit')).toBeVisible()
    expect(screen.getByText('Working Directory')).not.toBeVisible()
    expect(screen.getByText('Commit')).not.toBeVisible()

    // Clicking "Local changes" reveals the staging + commit panels and hides the timeline.
    fireEvent.click(screen.getByRole('button', { name: /Local changes/i }))

    expect(await screen.findByText('Working Directory')).toBeVisible()
    expect(screen.getByText('Commit')).toBeVisible()
    expect(screen.getByText('Timeline')).not.toBeVisible()
  })

  it('does not expose a Close repository control — closing the tab is the only exit', async () => {
    await renderWithRepo()

    expect(screen.queryByRole('button', { name: /Close repository/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch repository/i })).not.toBeInTheDocument()
  })

  it('shows the clean badge when no changes are pending', async () => {
    mockBaseAPI({
      workingDirectory: '/workspace',
      scanRepos: ['/workspace/repo']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      success: true,
      path: '/workspace/repo',
      status: { current: 'main', modified: [], staged: [], not_added: [] },
      log: { all: [], total: 0 },
      branches: { current: 'main', all: ['main'] }
    })

    render(<App />)
    const repoRow = await screen.findByText('/workspace/repo')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(screen.getAllByText('repo').length).toBeGreaterThanOrEqual(1)
    })
    // Clean badge lives in the StatusPanel, which only renders on the Local changes view.
    fireEvent.click(screen.getByRole('button', { name: /Local changes/i }))
    expect(screen.getAllByText('Clean').length).toBeGreaterThanOrEqual(1)
  })

  it('shows a banner when an openRepo error happens', async () => {
    mockBaseAPI({
      workingDirectory: '/workspace',
      scanRepos: ['/workspace/bad-repo']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      success: false,
      error: 'Not a git repository'
    })

    render(<App />)
    const repoRow = await screen.findByText('/workspace/bad-repo')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(screen.getByText('Not a git repository')).toBeInTheDocument()
    })
  })
})
