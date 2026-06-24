import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp, renderWithQuery } from '@/../test/render-app'
import { mockBranchResponses, setupLogStream, sidecarMock } from '@/../test/setup'
import { RepoTab } from '@/RepoTab'

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
    vi.mocked(window.electronAPI.getRecentRepos).mockResolvedValue([])

    renderApp()

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders the onboarding screen when onboarding is not complete', async () => {
    mockBaseAPI({ onboardingComplete: false })

    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Welcome to Rebase')).toBeInTheDocument()
    })
  })
})

describe('App — tab shell', () => {
  it('renders the repo rail with a new-tab button and theme toggle after onboarding', async () => {
    mockBaseAPI()

    renderApp()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open new tab/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Dark theme/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Light theme/i })).toBeInTheDocument()
  })

  it('starts with a single empty tab that shows the repo picker', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/repos' })

    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Open a repository')).toBeInTheDocument()
    })
    expect(screen.getByRole('searchbox', { name: /Search repositories/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open from disk/i })).not.toBeInTheDocument()
  })

  it('shows no repo tabs while only a blank tab is open and marks the new-tab button active', async () => {
    mockBaseAPI()

    renderApp()

    await screen.findByRole('button', { name: /Open new tab/i })
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Open new tab/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('clicking the new-tab button keeps a single blank tab instead of stacking blanks', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/repos' })

    renderApp()

    await screen.findByRole('button', { name: /Open new tab/i })
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(await screen.findByText('Open a repository')).toBeInTheDocument()
  })
})

describe('App — repo picker (no repo open)', () => {
  it('lists workspace repos discovered by scanForRepos', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/repos',
      scanRepos: ['/home/user/repos/my-app']
    })

    renderApp()

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

    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Recent')).toBeInTheDocument()
      expect(screen.getByText('/recent/repo')).toBeInTheDocument()
    })
  })

  it('shows the add-workspace hint when no workspace has been configured', async () => {
    mockBaseAPI()

    renderApp()

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
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })

    renderApp()

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

    renderApp()

    await screen.findByText('/home/user/repos/my-app')
    await screen.findByText('/recent/cool-repo')
    expect(screen.getByText('/home/user/repos/other-thing')).toBeInTheDocument()
    expect(screen.getByText('/recent/cool-repo')).toBeInTheDocument()
    expect(screen.getByText('/recent/something-else')).toBeInTheDocument()

    fireEvent.input(screen.getByRole('searchbox', { name: /Search repositories/i }), {
      target: { value: 'cool' }
    })

    expect(screen.getByText('/recent/cool-repo')).toBeInTheDocument()
    expect(screen.queryByText('/home/user/repos/my-app')).not.toBeInTheDocument()
    expect(screen.queryByText('/home/user/repos/other-thing')).not.toBeInTheDocument()
    expect(screen.queryByText('/recent/something-else')).not.toBeInTheDocument()
  })
})

describe('App — persisted tabs', () => {
  it('finishes opening a restored repo under StrictMode effect replay', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/projects' })
    let resolveOpen: () => void = () => {}
    vi.mocked(window.electronAPI.openRepo).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = () => {
            resolve({
              _tag: 'Ok',
              result: { path: '/home/user/projects/restored', remotes: {}, defaultBranch: 'main' }
            })
          }
        })
    )
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    const onRepoOpened = vi.fn()
    renderWithQuery(() => (
      <StrictMode>
        <RepoTab
          tabId="restored-tab"
          tabActive={true}
          repoPath="/home/user/projects/restored"
          catalog={{
            recentRepos: [],
            discoveredRepos: [],
            workspaces: [],
            activeWorkspace: null,
            switchWorkspace: vi.fn(),
            addWorkspace: vi.fn(),
            removeWorkspace: vi.fn()
          }}
          onOpenRepo={vi.fn()}
          onRepoOpened={onRepoOpened}
        />
      </StrictMode>
    ))

    await screen.findByText('Opening repository...')
    resolveOpen()

    await waitFor(() => {
      expect(onRepoOpened).toHaveBeenCalledWith('/home/user/projects/restored')
    })
    expect(screen.queryByText('Opening repository...')).not.toBeInTheDocument()
  })

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
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/restored')
    })
  })

  it('defers inactive restored repos until the user selects them', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/projects' })
    vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
      tabs: [
        '/home/user/projects/repo-a',
        '/home/user/projects/repo-b',
        '/home/user/projects/repo-c'
      ],
      activeIndex: 1
    })
    vi.mocked(window.electronAPI.openRepo).mockImplementation((path) =>
      Promise.resolve({
        _tag: 'Ok',
        result: { path, remotes: {}, defaultBranch: 'main' }
      })
    )
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/repo-b')
    })
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/home/user/projects/repo-b', {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
    })

    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('tab', { name: 'repo-a - not loaded yet' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'repo-c - not loaded yet' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'repo-a - not loaded yet' }))

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/repo-a')
    })
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/home/user/projects/repo-a', {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
    })

    expect(window.electronAPI.openRepo).not.toHaveBeenCalledWith('/home/user/projects/repo-c')
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalledWith(
      '/home/user/projects/repo-c',
      expect.anything()
    )
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
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()
    fireEvent.click(await screen.findByText('/home/user/projects/my-app'))

    await waitFor(() => {
      const setCalls = vi.mocked(window.electronAPI.setPersistedTabs).mock.calls
      expect(setCalls.some(([state]) => state.tabs.includes('/home/user/projects/my-app'))).toBe(
        true
      )
    })
  })

  it('keeps the repo picker available and skips persistence when repo open fails', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/stale-repo']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'NotARepo'
    })
    setupLogStream()

    renderApp()
    fireEvent.click(await screen.findByText('/home/user/projects/stale-repo'))

    await screen.findByText('Not a git repository')
    expect(screen.getByText('Open a repository')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /Search repositories/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(window.electronAPI.setPersistedTabs).toHaveBeenCalled()
    })
    const setCalls = vi.mocked(window.electronAPI.setPersistedTabs).mock.calls
    expect(setCalls.some(([state]) => state.tabs.includes('/home/user/projects/stale-repo'))).toBe(
      false
    )
  })

  it('can open a different repo in the same tab after repo open fails', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/stale-repo', '/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockImplementation((path) => {
      if (path === '/home/user/projects/stale-repo') {
        return Promise.resolve({ _tag: 'NotARepo' })
      }
      return Promise.resolve({
        _tag: 'Ok',
        result: { path, remotes: {}, defaultBranch: 'main' }
      })
    })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()
    fireEvent.click(await screen.findByText('/home/user/projects/stale-repo'))
    await screen.findByText('Not a git repository')

    fireEvent.click(screen.getByText('/home/user/projects/my-app'))

    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.openRepo).mock.calls.map(([path]) => path)).toContain(
        '/home/user/projects/my-app'
      )
    })
    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
    })
  })

  it('persists the canonical path returned by a successful repo open', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/link-to-my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/real/repos/my-app', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()
    fireEvent.click(await screen.findByText('/home/user/projects/link-to-my-app'))

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/link-to-my-app')
    })
    await waitFor(() => {
      const setCalls = vi.mocked(window.electronAPI.setPersistedTabs).mock.calls
      expect(setCalls.some(([state]) => state.tabs.includes('/real/repos/my-app'))).toBe(true)
    })
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
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
      renamed: [],
      files: []
    }
  }
  const branchesMock = {
    current: 'feature/ui',
    all: ['main', 'feature/ui'],
    remotes: [] as string[],
    tags: [] as string[]
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
    vi.mocked(sidecarMock.getStatus).mockResolvedValue(statusMock)
    mockBranchResponses(branchesMock)
    const stream = setupLogStream()

    renderApp()

    const repoRow = await screen.findByText('/home/user/projects/my-app')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/home/user/projects/my-app')
    })

    await screen.findByText('Timeline')
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/home/user/projects/my-app', {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
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
      expect(screen.getAllByText('feature/ui').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText(/1 modified, 2 staged, 1 untracked/)).toBeInTheDocument()
    })
  })

  it('refreshes the sidebar current branch after double-click checkout', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)
    vi.mocked(sidecarMock.getStatus)
      .mockResolvedValueOnce({
        ...statusMock,
        status: { ...statusMock.status, current: 'develop' }
      })
      .mockResolvedValue({
        ...statusMock,
        status: { ...statusMock.status, current: 'main' }
      })
    vi.mocked(sidecarMock.getLocalBranches)
      .mockResolvedValueOnce({
        _tag: 'Ok',
        branches: { current: 'develop', all: ['main', 'develop'] }
      })
      .mockResolvedValue({
        _tag: 'Ok',
        branches: { current: 'main', all: ['main', 'develop'] }
      })
    vi.mocked(sidecarMock.getRemoteRefs).mockResolvedValue({
      _tag: 'Ok',
      refs: { remotes: [], tags: [] }
    })
    vi.mocked(sidecarMock.checkout).mockResolvedValue({
      _tag: 'Ok',
      checkedOut: 'main'
    })
    setupLogStream()

    renderApp()

    fireEvent.click(await screen.findByText('/home/user/projects/my-app'))
    const developRow = (await screen.findByTitle('develop')).closest(
      '[data-testid="ref-tree-leaf-row"]'
    )
    expect(developRow).toBeTruthy()

    fireEvent.dblClick(screen.getByTitle('main'))

    await waitFor(() => {
      expect(sidecarMock.checkout).toHaveBeenCalledWith(
        '/home/user/projects/my-app',
        'local',
        'main'
      )
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      const mainRow = screen.getByTitle('main').closest('[data-testid="ref-tree-leaf-row"]')
      expect(mainRow).toBeTruthy()
      expect(within(mainRow as HTMLElement).getByTestId('current-ref-check')).toBeInTheDocument()
    })
  })

  it('defaults to the history view and swaps to the local-changes view from the topbar', async () => {
    await renderWithRepo()

    expect(await screen.findByText('Timeline')).toBeVisible()
    expect(await screen.findByText('Initial commit')).toBeVisible()
    expect(screen.queryByText(/files · /)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Local changes/i }))

    expect(await screen.findByText('4 files · 2 staged')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toBeVisible()
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument()
  })

  it('does not expose a Close repository control — closing the tab is the only exit', async () => {
    await renderWithRepo()

    expect(screen.queryByRole('button', { name: /Close repository/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch repository/i })).not.toBeInTheDocument()
  })

  it('shows the clean working-tree state when no changes are pending', async () => {
    mockBaseAPI({
      workingDirectory: '/workspace',
      scanRepos: ['/workspace/repo']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/workspace/repo', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()
    const repoRow = await screen.findByText('/workspace/repo')
    fireEvent.click(repoRow)

    fireEvent.click(await screen.findByRole('button', { name: /Local changes/i }))
    await waitFor(() => {
      expect(screen.getByText('Working tree clean')).toBeInTheDocument()
    })
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
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()

    fireEvent.click(await screen.findByText('/projects/repo-a'))
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/projects/repo-a')
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('repo-a')
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    const repoBMatches = await screen.findAllByText('/projects/repo-b')
    const repoBPickerRow = repoBMatches
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)
    fireEvent.click(repoBPickerRow as HTMLButtonElement)
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/projects/repo-b')
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    const repoAPickerRow = (await screen.findAllByText('/projects/repo-a'))
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => !!b)
      .at(-1)
    expect(repoAPickerRow).toBeTruthy()
    fireEvent.click(repoAPickerRow as HTMLButtonElement)

    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('repo-a')
    })
    const remainingTabs = screen.getAllByRole('tab')
    expect(remainingTabs).toHaveLength(2)
    expect(remainingTabs[0]).toHaveAccessibleName('repo-a')
    expect(remainingTabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(remainingTabs[1]).toHaveAccessibleName('repo-b')
    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(2)
  })

  it('keeps inactive tab log streams up to date', async () => {
    mockBaseAPI({
      workingDirectory: '/projects',
      scanRepos: ['/projects/repo-a', '/projects/repo-b']
    })
    vi.mocked(window.electronAPI.openRepo).mockImplementation((path) =>
      Promise.resolve({
        _tag: 'Ok',
        result: { path, remotes: {}, defaultBranch: 'feature/ui' }
      })
    )
    vi.mocked(sidecarMock.getStatus).mockResolvedValue(statusMock)
    mockBranchResponses(branchesMock)
    const stream = setupLogStream()

    renderApp()

    fireEvent.click(await screen.findByText('/projects/repo-a'))
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/projects/repo-a', {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
    })
    await screen.findByTitle('main')

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    const repoBPickerRow = (await screen.findAllByText('/projects/repo-b'))
      .map((el) => el.closest('button'))
      .find((button): button is HTMLButtonElement => !!button)
    fireEvent.click(repoBPickerRow as HTMLButtonElement)
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/projects/repo-b', {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
    })

    stream.fire({
      repoPath: '/projects/repo-a',
      commits: [{ ...sampleCommit, hash: 'hidden123', message: 'Hidden tab commit' }]
    })
    stream.fireDone('/projects/repo-a')

    fireEvent.click(screen.getByRole('tab', { name: /repo-a/i }))

    expect(await screen.findByText('Hidden tab commit')).toBeVisible()
  })

  it('switches to the existing tab instead of loading the repo twice', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)
    setupLogStream()

    renderApp()

    const firstRow = await screen.findByText('/home/user/projects/my-app')
    fireEvent.click(firstRow)
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Open new tab/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    const matches = await screen.findAllByText('/home/user/projects/my-app')
    const pickerRow = matches
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => !!b)
      .at(-1)
    expect(pickerRow).toBeTruthy()
    fireEvent.click(pickerRow as HTMLButtonElement)

    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
    })
    expect(screen.getAllByRole('tab')).toHaveLength(1)
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

    renderApp()
    const repoRow = await screen.findByText('/workspace/bad-repo')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(screen.getByText('Not a git repository')).toBeInTheDocument()
    })
  })
})
