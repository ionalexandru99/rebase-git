import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupLogStream } from '@/../test/setup'
import App from '@/App'

beforeEach(() => {
  // Every test that mounts App may open a repo and trigger the log stream
  // subscription; install a default mock so the hook's useEffect resolves.
  setupLogStream()
})

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

  it('closing the active middle tab selects the right neighbour', async () => {
    mockBaseAPI()

    render(<App />)

    await screen.findByRole('button', { name: /Open new tab/i })
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(3)

    // Activate the middle tab and close it.
    const middleTab = screen.getAllByRole('tab')[1]
    fireEvent.click(middleTab)
    expect(middleTab).toHaveAttribute('aria-selected', 'true')

    const closeButtons = screen.getAllByRole('button', { name: /Close tab/i })
    fireEvent.click(closeButtons[1])

    const tabsAfter = screen.getAllByRole('tab')
    expect(tabsAfter).toHaveLength(2)
    // The new right neighbour (formerly index 2) is now at index 1 and active.
    expect(tabsAfter[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabsAfter[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('closing the active rightmost tab selects the left neighbour', async () => {
    mockBaseAPI()

    render(<App />)

    await screen.findByRole('button', { name: /Open new tab/i })
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    // The newly-created tab is already active and is the rightmost.
    const tabs = screen.getAllByRole('tab')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getAllByRole('button', { name: /Close tab/i })[1])

    const tabsAfter = screen.getAllByRole('tab')
    expect(tabsAfter).toHaveLength(1)
    expect(tabsAfter[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('closing an inactive tab leaves the current selection alone', async () => {
    mockBaseAPI()

    render(<App />)

    await screen.findByRole('button', { name: /Open new tab/i })
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    // Go back to tab 1 and then close tab 2 (inactive). Tab 1 stays selected.
    fireEvent.click(screen.getAllByRole('tab')[0])
    fireEvent.click(screen.getAllByRole('button', { name: /Close tab/i })[1])

    const tabsAfter = screen.getAllByRole('tab')
    expect(tabsAfter).toHaveLength(1)
    expect(tabsAfter[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('closing the only remaining tab replaces it with a fresh selected tab', async () => {
    mockBaseAPI()

    render(<App />)

    await screen.findByRole('button', { name: /Open new tab/i })
    const initialTab = screen.getByRole('tab')

    fireEvent.click(screen.getByRole('button', { name: /Close tab/i }))

    // One tab still exists — a brand-new instance, and it's the active one.
    const tabsAfter = screen.getAllByRole('tab')
    expect(tabsAfter).toHaveLength(1)
    expect(tabsAfter[0]).not.toBe(initialTab)
    expect(tabsAfter[0]).toHaveAttribute('aria-selected', 'true')
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
    branches: { current: 'feature/ui', all: ['main', 'feature/ui'] }
  }
  const sampleCommit = {
    hash: '1234567abc',
    message: 'Initial commit',
    author_name: 'Jane Doe',
    date: new Date().toISOString(),
    parents: [],
    refs: 'HEAD -> feature/ui'
  }

  async function renderWithRepo() {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)
    const stream = setupLogStream()

    render(<App />)

    const repoRow = await screen.findByText('/home/user/projects/my-app')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/my-app')
    })

    // Push one commit and signal end-of-stream so any "log loaded" UI lights up.
    stream.fire({
      repoPath: '/home/user/projects/my-app',
      commits: [sampleCommit]
    })
    stream.fireDone('/home/user/projects/my-app')
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
    expect(await screen.findByText('Initial commit')).toBeVisible()
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
      branches: { current: 'main', all: ['main'] }
    })
    setupLogStream()

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

  it('redirects to the existing tab when a third tab tries to open the same repo', async () => {
    // Two repos live in the workspace; we open A in tab 1, B in tab 2, then
    // try to open A again from a new tab 3 and expect to land on tab 1
    // (not on tab 2, which is the closed tab's neighbour).
    mockBaseAPI({
      workingDirectory: '/projects',
      scanRepos: ['/projects/repo-a', '/projects/repo-b']
    })
    vi.mocked(window.electronAPI.openRepo).mockImplementation((path) =>
      Promise.resolve({
        success: true,
        path,
        status: { current: 'main', modified: [], staged: [], not_added: [] },
        branches: { current: 'main', all: ['main'] }
      })
    )
    setupLogStream()

    render(<App />)

    // Tab 1: open repo-a.
    fireEvent.click(await screen.findByText('/projects/repo-a'))
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/projects/repo-a')
    })

    // Tab 2: open repo-b.
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    const repoBMatches = await screen.findAllByText('/projects/repo-b')
    const repoBPickerRow = repoBMatches
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)
    fireEvent.click(repoBPickerRow as HTMLButtonElement)
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/projects/repo-b')
    })

    // Tab 3 (empty) — pick repo-a, which already lives in tab 1.
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    const repoAMatches = await screen.findAllByText('/projects/repo-a')
    const repoAPickerRow = repoAMatches
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)
    fireEvent.click(repoAPickerRow as HTMLButtonElement)

    // Tab 3 closes; the active tab is tab 1 (repo-a), not tab 2 (repo-b).
    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2)
    })
    const remainingTabs = screen.getAllByRole('tab')
    expect(remainingTabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(remainingTabs[0]).toHaveTextContent('repo-a')
    expect(remainingTabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(remainingTabs[1]).toHaveTextContent('repo-b')
    // openRepo was only called for the two distinct repos.
    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(2)
  })

  it('switches to the existing tab instead of loading the repo twice', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)
    setupLogStream()

    render(<App />)

    // Open the repo in tab 1.
    const firstRow = await screen.findByText('/home/user/projects/my-app')
    fireEvent.click(firstRow)
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
    })

    // Open a new (empty) tab. After this, the repo path appears twice in the
    // DOM: once in tab 1's topbar (hidden) and once in tab 2's picker row.
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    // Click the picker row (the path lives inside a button); pick the second
    // match so we're clicking the picker, not the topbar text.
    const matches = await screen.findAllByText('/home/user/projects/my-app')
    const pickerRow = matches
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)
    expect(pickerRow).toBeTruthy()
    fireEvent.click(pickerRow as HTMLButtonElement)

    // Duplicate is intercepted: no second openRepo, and the empty tab is closed.
    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(1)
    })
    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
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
