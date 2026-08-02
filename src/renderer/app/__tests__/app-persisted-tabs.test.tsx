import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RepoTab } from '@/app/RepoTab'
import { openedRepoResponse, statusResponse } from '../../../test/builders'
import { renderApp, renderWithQuery } from '../../../test/render-app'
import { mockBranchResponses, setupLogStream, sidecarMock } from '../../../test/setup'
import { mockBaseAPI, mockSuccessfulRepo } from './app-test-harness'

describe('App — persisted tabs', () => {
  it('finishes opening a restored repo under StrictMode effect replay', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/projects' })
    let resolveOpen: () => void = () => {}
    vi.mocked(window.electronAPI.openRepo).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = () => {
            resolve(openedRepoResponse('/home/user/projects/restored'))
          }
        })
    )
    sidecarMock.getStatus.mockResolvedValue(statusResponse())
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
            removeWorkspace: vi.fn(),
            refresh: vi.fn()
          }}
          onOpenRepo={vi.fn()}
          onRepoOpened={onRepoOpened}
          onRepoOpenFailed={vi.fn()}
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
    mockSuccessfulRepo('/home/user/projects/restored')
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
        '/home/user/projects/restored',
        expect.any(Number)
      )
    })
  })

  it('reopens persisted repos on boot under StrictMode effect replay', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/projects' })
    vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
      tabs: ['/home/user/projects/restored'],
      activeIndex: 0
    })
    mockSuccessfulRepo('/home/user/projects/restored')
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp({ strictMode: true })

    expect(await screen.findByRole('tab', { name: /restored/i })).toBeInTheDocument()
    expect(screen.queryByText('Opening repository...')).not.toBeInTheDocument()
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
      Promise.resolve(openedRepoResponse(path))
    )
    sidecarMock.getStatus.mockResolvedValue(statusResponse())
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
        '/home/user/projects/repo-b',
        expect.any(Number)
      )
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
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
        '/home/user/projects/repo-a',
        expect.any(Number)
      )
    })
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/home/user/projects/repo-a', {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
    })

    expect(window.electronAPI.openRepo).not.toHaveBeenCalledWith(
      '/home/user/projects/repo-c',
      expect.any(Number)
    )
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
    mockSuccessfulRepo('/home/user/projects/my-app')
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
      return Promise.resolve(openedRepoResponse(path))
    })
    sidecarMock.getStatus.mockResolvedValue(statusResponse())
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
    mockSuccessfulRepo('/real/repos/my-app')
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()
    fireEvent.click(await screen.findByText('/home/user/projects/link-to-my-app'))

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
        '/home/user/projects/link-to-my-app',
        expect.any(Number)
      )
    })
    await waitFor(() => {
      const setCalls = vi.mocked(window.electronAPI.setPersistedTabs).mock.calls
      expect(setCalls.some(([state]) => state.tabs.includes('/real/repos/my-app'))).toBe(true)
    })
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
  })

  it('keeps the existing canonical tab owner when an alias resolves to the same repo', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/repo-link']
    })
    vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
      tabs: ['/real/repos/project', null],
      activeIndex: 0
    })
    vi.mocked(window.electronAPI.openRepo).mockImplementation((path) =>
      Promise.resolve(
        openedRepoResponse(path === '/home/user/projects/repo-link' ? '/real/repos/project' : path)
      )
    )
    sidecarMock.getStatus.mockResolvedValue(statusResponse())
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })

    renderApp()
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
        '/real/repos/project',
        expect.any(Number)
      )
    })
    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    fireEvent.click(await screen.findByText('/home/user/projects/repo-link'))

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(1)
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('project')
    })
    await waitFor(() => {
      const canonicalOpens = vi
        .mocked(window.electronAPI.openRepo)
        .mock.calls.filter(([path]) => path === '/real/repos/project')
      expect(canonicalOpens.length).toBeGreaterThanOrEqual(2)
    })
    expect(window.electronAPI.closeRepo).not.toHaveBeenCalledWith(
      '/real/repos/project',
      expect.any(Number)
    )
  })
})
