import { GetIdentity, SetIdentity } from '@shared/rpc'
import type { UpdaterState } from '@shared/schemas/ipc'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { openedRepoResponse, statusResponse } from '../../../test/builders'
import { renderApp } from '../../../test/render-app'
import { mockBranchResponses, setupLogStream, sidecarMock } from '../../../test/setup'
import { mockBaseAPI } from './app-test-harness'

const MY_APP = '/home/user/projects/my-app'
const WEB_APP = '/home/user/projects/web-app'

const LOCAL_IDENTITIES: Record<string, { name?: string; email?: string }> = {
  [MY_APP]: { email: 'my-app@example.com' },
  [WEB_APP]: { email: 'web-app@example.com' }
}

function mockTwoRepoTabs() {
  mockBaseAPI({ workingDirectory: '/home/user/projects' })
  vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
    tabs: [MY_APP, WEB_APP],
    activeIndex: 0
  })
  vi.mocked(window.electronAPI.openRepo).mockImplementation(async (repoPath: string) =>
    openedRepoResponse(repoPath)
  )
  sidecarMock.getStatus.mockResolvedValue(statusResponse())
  mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
  setupLogStream()
  sidecarMock.respond(GetIdentity, ({ repoPath }) => ({
    _tag: 'Ok',
    local: repoPath ? (LOCAL_IDENTITIES[repoPath] ?? {}) : {},
    global: { name: 'Global Name', email: 'global@example.com' },
    effective: { name: 'Global Name', email: 'global@example.com' }
  }))
}

const gear = () => screen.getByRole('button', { name: 'Settings' })

const updaterState = (overrides: Partial<UpdaterState> = {}): UpdaterState => ({
  status: 'idle',
  supported: true,
  unsupportedReason: null,
  currentVersion: '1.0.0',
  availableVersion: null,
  downloadPercent: null,
  lastCheckedAt: null,
  errorMessage: null,
  ...overrides
})

function captureUpdaterPushes() {
  const listeners: Array<(state: UpdaterState) => void> = []
  vi.mocked(window.electronAPI.onUpdaterStateChanged).mockImplementation((callback) => {
    listeners.push(callback)
    return () => {}
  })
  return (state: UpdaterState) => {
    act(() => {
      for (const listener of listeners) {
        listener(state)
      }
    })
  }
}

const openGitIdentitySection = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Git identity' }))
}

describe('App — settings', () => {
  it('opens the active tab settings from the rail gear', async () => {
    mockTwoRepoTabs()

    renderApp()
    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
    })
    fireEvent.click(gear())

    expect(await screen.findByTestId('settings-view')).toBeInTheDocument()
    await openGitIdentitySection()
    expect(await screen.findByDisplayValue('my-app@example.com')).toBeInTheDocument()
  })

  it('closes the settings view from the same gear', async () => {
    mockTwoRepoTabs()

    renderApp()
    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
    })
    fireEvent.click(gear())
    await screen.findByTestId('settings-view')
    fireEvent.click(gear())

    await waitFor(() => {
      expect(screen.queryByTestId('settings-view')).toBeNull()
    })
  })

  it('follows the active tab so each repo shows its own settings', async () => {
    mockTwoRepoTabs()

    renderApp()
    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
    })
    fireEvent.click(gear())
    await openGitIdentitySection()
    await screen.findByDisplayValue('my-app@example.com')
    fireEvent.click(screen.getByRole('tab', { name: /^web-app/ }))

    await openGitIdentitySection()
    expect(await screen.findByDisplayValue('web-app@example.com')).toBeInTheDocument()
  })

  it('shows the app section alone on a tab with no repository', async () => {
    mockTwoRepoTabs()
    vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
      tabs: [null],
      activeIndex: 0
    })

    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await openGitIdentitySection()

    expect(await screen.findByRole('group', { name: 'App settings' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Repository settings' })).toBeNull()
  })

  it('badges the gear while an update is pending and clears it afterwards', async () => {
    mockTwoRepoTabs()
    const pushUpdaterState = captureUpdaterPushes()

    renderApp()
    await screen.findByRole('button', { name: 'Settings' })
    expect(screen.queryByTestId('settings-update-badge')).toBeNull()

    pushUpdaterState(updaterState({ status: 'available', availableVersion: '1.3.0' }))
    expect(screen.getByRole('button', { name: 'Settings, update available' })).toBeInTheDocument()
    expect(screen.getByTestId('settings-update-badge')).toBeInTheDocument()

    pushUpdaterState(updaterState({ status: 'downloaded', availableVersion: '1.3.0' }))
    expect(screen.getByTestId('settings-update-badge')).toBeInTheDocument()

    pushUpdaterState(updaterState({ status: 'up-to-date' }))
    expect(screen.queryByTestId('settings-update-badge')).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('keeps the gear plain when a check fails', async () => {
    mockTwoRepoTabs()
    const pushUpdaterState = captureUpdaterPushes()

    renderApp()
    await screen.findByRole('button', { name: 'Settings' })

    pushUpdaterState(updaterState({ status: 'error', errorMessage: 'cannot reach the server' }))

    expect(screen.queryByTestId('settings-update-badge')).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('opens settings on the Updates section from a badged gear', async () => {
    mockTwoRepoTabs()
    vi.mocked(window.electronAPI.getUpdaterState).mockResolvedValue(
      updaterState({ status: 'downloaded', availableVersion: '1.3.0' })
    )

    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings, update available' }))

    await screen.findByTestId('settings-view')
    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }))
    await waitFor(() => {
      expect(nav.getByRole('button', { name: 'Updates' })).toHaveAttribute('aria-current', 'true')
    })
    expect(
      within(nav.getByRole('button', { name: 'Updates' })).getByTestId('updates-nav-badge')
    ).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'Version' })).toBeInTheDocument()
  })

  it('opens settings on the first section when no update is pending', async () => {
    mockTwoRepoTabs()

    renderApp()
    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
    })
    fireEvent.click(gear())

    await screen.findByTestId('settings-view')
    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }))
    await waitFor(() => {
      expect(nav.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'true')
    })
  })

  it('sends the edited app identity to the sidecar', async () => {
    mockTwoRepoTabs()
    const setIdentity = vi.fn(() => ({ _tag: 'Ok' as const }))
    sidecarMock.respond(SetIdentity, setIdentity)

    renderApp()
    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
    })
    fireEvent.click(gear())
    await openGitIdentitySection()
    const appSettings = within(await screen.findByRole('group', { name: 'App settings' }))
    fireEvent.change(appSettings.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.click(appSettings.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(setIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'global',
          name: 'Ada Lovelace',
          email: 'global@example.com'
        })
      )
    })
  })
})
