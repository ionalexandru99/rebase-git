import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../../test/render-app'
import { mockBranchResponses } from '../../../test/setup'
import { mockBaseAPI, mockSuccessfulRepo } from './app-test-harness'

describe('App — onboarding gate', () => {
  it('shows a loading state while checking onboarding status', () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockReturnValue(new Promise(() => {}))
    vi.mocked(window.electronAPI.getWorkspaces).mockReturnValue(new Promise(() => {}))
    vi.mocked(window.electronAPI.getActiveWorkspace).mockReturnValue(new Promise(() => {}))
    vi.mocked(window.electronAPI.getPersistedTabs).mockReturnValue(new Promise(() => {}))

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

  it('opens a selected onboarding repo through an owned tab session', async () => {
    mockBaseAPI({
      onboardingComplete: false,
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/app']
    })
    vi.mocked(window.electronAPI.setOnboardingComplete).mockResolvedValue(undefined)
    mockSuccessfulRepo('/home/user/projects/app')
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })

    renderApp()
    fireEvent.click(await screen.findByText('/home/user/projects/app'))

    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('app')
    })
    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
      '/home/user/projects/app',
      expect.any(Number)
    )
  })
})

describe('App — tab shell', () => {
  it('renders the repo rail with a new-tab button and no theme toggle after onboarding', async () => {
    mockBaseAPI()

    renderApp()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open new tab/i })).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: /Switch to (light|dark) theme/i })
    ).not.toBeInTheDocument()
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
    mockSuccessfulRepo('/home/user/repos/my-app')
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })

    renderApp()

    const repoEntry = await screen.findByText('/home/user/repos/my-app')
    fireEvent.click(repoEntry)

    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
        '/home/user/repos/my-app',
        expect.any(Number)
      )
    })
  })

  it('opens a picked repo under StrictMode effect replay', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/repos',
      scanRepos: ['/home/user/repos/my-app']
    })
    mockSuccessfulRepo('/home/user/repos/my-app')
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })

    renderApp({ strictMode: true })

    fireEvent.click(await screen.findByText('/home/user/repos/my-app'))

    expect(await screen.findByRole('tab', { name: /my-app/i })).toBeInTheDocument()
    expect(screen.queryByText('Opening repository...')).not.toBeInTheDocument()
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

  it('clears repository search from an explicit control', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/repos',
      scanRepos: ['/home/user/repos/my-app'],
      recentRepos: ['/recent/cool-repo']
    })
    renderApp()
    await screen.findByText('/home/user/repos/my-app')

    fireEvent.input(screen.getByRole('searchbox', { name: /Search repositories/i }), {
      target: { value: 'cool' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear repository search' }))

    expect(screen.getByRole('searchbox', { name: /Search repositories/i })).toHaveValue('')
    expect(screen.getByText('/home/user/repos/my-app')).toBeInTheDocument()
  })
})
