import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupLogStream } from '@/../test/setup'
import App from '@/App'

beforeEach(() => {
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
    _tag: 'Ok',
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

    const middleTab = screen.getAllByRole('tab')[1]
    fireEvent.click(middleTab)
    expect(middleTab).toHaveAttribute('aria-selected', 'true')

    const closeButtons = screen.getAllByRole('button', { name: /Close tab/i })
    fireEvent.click(closeButtons[1])

    const tabsAfter = screen.getAllByRole('tab')
    expect(tabsAfter).toHaveLength(2)
    expect(tabsAfter[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabsAfter[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('closing the active rightmost tab selects the left neighbour', async () => {
    mockBaseAPI()

    render(<App />)

    await screen.findByRole('button', { name: /Open new tab/i })
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)

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
      _tag: 'Ok',
      result: { path: '/home/user/repos/my-app', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: []
      }
    })
    vi.mocked(window.electronAPI.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main'], remotes: [], tags: [] }
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

describe('App — persisted tabs', () => {
  it('reopens persisted repos on boot', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/projects' })
    vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
      tabs: ['/home/user/projects/restored'],
      activeIndex: 0
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/home/user/projects/restored', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: []
      }
    })
    vi.mocked(window.electronAPI.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main'], remotes: [], tags: [] }
    })
    setupLogStream()

    render(<App />)

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/restored')
    })
  })

  it('persists the current tab state when a tab opens a repo', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/home/user/projects/my-app', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: []
      }
    })
    vi.mocked(window.electronAPI.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main'], remotes: [], tags: [] }
    })
    setupLogStream()

    render(<App />)
    fireEvent.click(await screen.findByText('/home/user/projects/my-app'))

    await waitFor(() => {
      const setCalls = vi.mocked(window.electronAPI.setPersistedTabs).mock.calls
      expect(setCalls.some(([state]) => state.tabs.includes('/home/user/projects/my-app'))).toBe(
        true
      )
    })
  })
})

describe('App — workspace (repo open)', () => {
  const openRepoMock = {
    _tag: 'Ok' as const,
    result: {
      path: '/home/user/projects/my-app',
      remotes: {},
      defaultBranch: 'feature/ui'
    }
  }
  const statusMock = {
    _tag: 'Ok' as const,
    status: {
      current: 'feature/ui',
      modified: ['src/a.ts'],
      staged: ['src/b.ts', 'src/c.ts'],
      not_added: ['new.ts'],
      conflicted: [],
      deleted: [],
      created: [],
      renamed: []
    }
  }
  const branchesMock = {
    _tag: 'Ok' as const,
    branches: { current: 'feature/ui', all: ['main', 'feature/ui'], remotes: [], tags: [] }
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
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue(statusMock)
    vi.mocked(window.electronAPI.getBranches).mockResolvedValue(branchesMock)
    const stream = setupLogStream()

    render(<App />)

    const repoRow = await screen.findByText('/home/user/projects/my-app')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/my-app')
    })

    stream.fire({
      repoPath: '/home/user/projects/my-app',
      commits: [sampleCommit]
    })
    stream.fireDone('/home/user/projects/my-app')
  }

  it('renders the repo dashboard with name, branch, and change counts', async () => {
    await renderWithRepo()

    await waitFor(() => {
      expect(screen.getAllByText('my-app').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getAllByText('feature/ui').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/4 changes/)).toBeInTheDocument()
  })

  it('defaults to the history view and swaps to the local-changes view from the sidebar', async () => {
    await renderWithRepo()

    expect(await screen.findByText('Timeline')).toBeVisible()
    expect(await screen.findByText('Initial commit')).toBeVisible()
    expect(screen.getByText('Working Directory')).not.toBeVisible()
    expect(screen.getByText('Commit')).not.toBeVisible()

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
      _tag: 'Ok',
      result: { path: '/workspace/repo', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: []
      }
    })
    vi.mocked(window.electronAPI.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main'], remotes: [], tags: [] }
    })
    setupLogStream()

    render(<App />)
    const repoRow = await screen.findByText('/workspace/repo')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(screen.getAllByText('repo').length).toBeGreaterThanOrEqual(1)
    })
    fireEvent.click(screen.getByRole('button', { name: /Local changes/i }))
    expect(screen.getAllByText('Clean').length).toBeGreaterThanOrEqual(1)
  })

  it('redirects to the existing tab when a third tab tries to open the same repo', async () => {
    mockBaseAPI({
      workingDirectory: '/projects',
      scanRepos: ['/projects/repo-a', '/projects/repo-b']
    })
    vi.mocked(window.electronAPI.openRepo).mockImplementation((path) =>
      Promise.resolve({
        _tag: 'Ok',
        result: { path, remotes: {}, defaultBranch: 'main' }
      })
    )
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: []
      }
    })
    vi.mocked(window.electronAPI.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main'], remotes: [], tags: [] }
    })
    setupLogStream()

    render(<App />)

    fireEvent.click(await screen.findByText('/projects/repo-a'))
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/projects/repo-a')
    })

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

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    const repoAMatches = await screen.findAllByText('/projects/repo-a')
    const repoAPickerRow = repoAMatches
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)
    fireEvent.click(repoAPickerRow as HTMLButtonElement)

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2)
    })
    const remainingTabs = screen.getAllByRole('tab')
    expect(remainingTabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(remainingTabs[0]).toHaveTextContent('repo-a')
    expect(remainingTabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(remainingTabs[1]).toHaveTextContent('repo-b')
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

    const firstRow = await screen.findByText('/home/user/projects/my-app')
    fireEvent.click(firstRow)
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    const matches = await screen.findAllByText('/home/user/projects/my-app')
    const pickerRow = matches
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)
    expect(pickerRow).toBeTruthy()
    fireEvent.click(pickerRow as HTMLButtonElement)

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
      _tag: 'NotARepo'
    })

    render(<App />)
    const repoRow = await screen.findByText('/workspace/bad-repo')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(screen.getByText('Not a git repository')).toBeInTheDocument()
    })
  })
})
