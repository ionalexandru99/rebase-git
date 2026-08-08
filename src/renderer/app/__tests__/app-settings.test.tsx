import { GetIdentity, SetIdentity } from '@shared/rpc'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
