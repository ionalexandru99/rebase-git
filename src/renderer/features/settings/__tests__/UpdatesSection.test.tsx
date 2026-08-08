import type { UpdaterState } from '@shared/schemas/ipc'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { UpdatesContent, UpdatesNavBadge, updatesSection } from '../UpdatesSection'

const updaterState = (overrides: Partial<UpdaterState> = {}): UpdaterState => ({
  status: 'idle',
  supported: true,
  unsupportedReason: null,
  currentVersion: '1.2.3',
  availableVersion: null,
  downloadPercent: null,
  lastCheckedAt: null,
  errorMessage: null,
  ...overrides
})

const versionRow = () => within(screen.getByRole('group', { name: 'Version' }))

const channelSelect = () => screen.getByRole('combobox', { name: 'Update channel' })

async function renderUpdates(state: UpdaterState) {
  vi.mocked(window.electronAPI.getUpdaterState).mockResolvedValue(state)
  render(<UpdatesContent />)
  await waitFor(() =>
    expect(screen.getByText(`Rebase ${state.currentVersion}`)).toBeInTheDocument()
  )
}

describe('UpdatesSection', () => {
  it('offers a check while idle and starts one on click', async () => {
    await renderUpdates(updaterState())

    const checkButton = versionRow().getByRole('button', { name: 'Check for updates' })
    expect(checkButton).toBeEnabled()

    fireEvent.click(checkButton)

    expect(window.electronAPI.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('holds the button inert while a check runs', async () => {
    await renderUpdates(updaterState({ status: 'checking' }))

    expect(versionRow().getByRole('button', { name: 'Checking…' })).toBeDisabled()
  })

  it('says the app is current after an empty check', async () => {
    await renderUpdates(
      updaterState({ status: 'up-to-date', lastCheckedAt: '2026-08-08T10:00:00.000Z' })
    )

    expect(versionRow().getByText("You're on the latest version.")).toBeInTheDocument()
    expect(versionRow().getByText(/Last checked/)).toBeInTheDocument()
  })

  it('offers a download when an update is available', async () => {
    await renderUpdates(updaterState({ status: 'available', availableVersion: '1.3.0' }))

    expect(versionRow().getByText('Version 1.3.0 is ready to download.')).toBeInTheDocument()

    fireEvent.click(versionRow().getByRole('button', { name: 'Download' }))

    expect(window.electronAPI.downloadUpdate).toHaveBeenCalledOnce()
  })

  it('shows download progress and refuses interaction meanwhile', async () => {
    await renderUpdates(
      updaterState({ status: 'downloading', availableVersion: '1.3.0', downloadPercent: 42.4 })
    )

    expect(versionRow().getByRole('button', { name: 'Downloading… 42%' })).toBeDisabled()
  })

  it('offers install and restart once the download finished', async () => {
    await renderUpdates(updaterState({ status: 'downloaded', availableVersion: '1.3.0' }))

    expect(versionRow().getByText('Version 1.3.0 is ready to install.')).toBeInTheDocument()

    fireEvent.click(versionRow().getByRole('button', { name: 'Install and restart' }))

    expect(window.electronAPI.installUpdate).toHaveBeenCalledOnce()
  })

  it('shows the failure and lets the user check again', async () => {
    await renderUpdates(
      updaterState({ status: 'error', errorMessage: 'cannot reach the update server' })
    )

    expect(versionRow().getByText('cannot reach the update server')).toBeInTheDocument()
    expect(versionRow().getByRole('button', { name: 'Check for updates' })).toBeEnabled()
  })

  it('rerenders when main pushes a new update state', async () => {
    let pushState: ((state: UpdaterState) => void) | null = null
    vi.mocked(window.electronAPI.onUpdaterStateChanged).mockImplementation((callback) => {
      pushState = callback
      return () => {}
    })

    await renderUpdates(updaterState())
    expect(versionRow().getByRole('button', { name: 'Check for updates' })).toBeInTheDocument()

    act(() => {
      pushState?.(updaterState({ status: 'downloaded', availableVersion: '1.3.0' }))
    })

    expect(versionRow().getByRole('button', { name: 'Install and restart' })).toBeInTheDocument()
  })

  it('shows the reason when an action is rejected', async () => {
    vi.mocked(window.electronAPI.checkForUpdates).mockResolvedValue({
      _tag: 'Rejected',
      reason: 'A check for updates is already running.'
    })
    await renderUpdates(updaterState())

    fireEvent.click(versionRow().getByRole('button', { name: 'Check for updates' }))

    await waitFor(() =>
      expect(versionRow().getByText('A check for updates is already running.')).toBeInTheDocument()
    )
  })

  it('shows the stored toggles and persists a change', async () => {
    vi.mocked(window.electronAPI.getUpdatePreferences).mockResolvedValue({
      downloadInBackground: false,
      installOnQuit: true
    })
    await renderUpdates(updaterState())

    const backgroundToggle = screen.getByRole('checkbox', {
      name: 'Download updates in the background'
    })
    const installToggle = screen.getByRole('checkbox', { name: 'Install when I quit' })
    await waitFor(() => expect(backgroundToggle).toBeEnabled())
    expect(backgroundToggle).not.toBeChecked()
    expect(installToggle).toBeChecked()

    fireEvent.click(backgroundToggle)

    expect(window.electronAPI.setUpdatePreferences).toHaveBeenCalledWith({
      downloadInBackground: true,
      installOnQuit: true
    })
    expect(backgroundToggle).toBeChecked()

    fireEvent.click(installToggle)

    expect(window.electronAPI.setUpdatePreferences).toHaveBeenLastCalledWith({
      downloadInBackground: true,
      installOnQuit: false
    })
  })

  it('shows the persisted channel without any warning on stable', async () => {
    await renderUpdates(updaterState())

    await waitFor(() => expect(channelSelect()).toBeEnabled())
    expect(channelSelect()).toHaveValue('stable')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reflects a persisted nightly channel and warns about it', async () => {
    vi.mocked(window.electronAPI.getUpdateChannel).mockResolvedValue('nightly')
    await renderUpdates(updaterState())

    await waitFor(() => expect(channelSelect()).toHaveValue('nightly'))
    expect(screen.getByRole('alert')).toHaveTextContent('Nightly builds ship straight from main')
  })

  it('persists a channel switch and shows the nightly warning', async () => {
    await renderUpdates(updaterState())
    await waitFor(() => expect(channelSelect()).toBeEnabled())

    fireEvent.change(channelSelect(), { target: { value: 'nightly' } })

    expect(window.electronAPI.setUpdateChannel).toHaveBeenCalledWith('nightly')
    expect(channelSelect()).toHaveValue('nightly')
    expect(screen.getByRole('alert')).toHaveTextContent('not release tested')
  })

  it('hides the warning again after switching back to stable', async () => {
    vi.mocked(window.electronAPI.getUpdateChannel).mockResolvedValue('nightly')
    await renderUpdates(updaterState())
    await waitFor(() => expect(channelSelect()).toHaveValue('nightly'))

    fireEvent.change(channelSelect(), { target: { value: 'stable' } })

    expect(window.electronAPI.setUpdateChannel).toHaveBeenCalledWith('stable')
    expect(channelSelect()).toHaveValue('stable')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the channel control inert while a check runs', async () => {
    await renderUpdates(updaterState({ status: 'checking' }))

    expect(channelSelect()).toBeDisabled()
  })

  it('keeps the channel control inert while a download runs', async () => {
    await renderUpdates(
      updaterState({ status: 'downloading', availableVersion: '1.3.0', downloadPercent: 10 })
    )

    expect(channelSelect()).toBeDisabled()
  })

  it('reverts the selection and shows the reason when a change is rejected', async () => {
    vi.mocked(window.electronAPI.setUpdateChannel).mockResolvedValue({
      _tag: 'Rejected',
      reason: 'An update is downloading right now.'
    })
    await renderUpdates(updaterState())
    await waitFor(() => expect(channelSelect()).toBeEnabled())

    fireEvent.change(channelSelect(), { target: { value: 'nightly' } })

    await waitFor(() => expect(channelSelect()).toHaveValue('stable'))
    expect(screen.getByText('An update is downloading right now.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('rolls the channel back when the save call itself fails', async () => {
    vi.mocked(window.electronAPI.setUpdateChannel).mockRejectedValue(new Error('ipc down'))
    await renderUpdates(updaterState())
    await waitFor(() => expect(channelSelect()).toBeEnabled())

    fireEvent.change(channelSelect(), { target: { value: 'nightly' } })

    await waitFor(() => expect(channelSelect()).toHaveValue('stable'))
    expect(screen.getByText('The channel change did not save. Try again.')).toBeInTheDocument()
  })

  it('rolls the toggles back when the preference save fails', async () => {
    vi.mocked(window.electronAPI.setUpdatePreferences).mockRejectedValue(new Error('ipc down'))
    await renderUpdates(updaterState())
    const downloadToggle = screen.getByRole('checkbox', {
      name: 'Download updates in the background'
    })
    await waitFor(() => expect(downloadToggle).toBeEnabled())
    expect(downloadToggle).toBeChecked()

    fireEvent.click(downloadToggle)

    await waitFor(() => expect(downloadToggle).toBeChecked())
  })

  it('registers the nav badge on its section entry', () => {
    expect(updatesSection.NavBadge).toBe(UpdatesNavBadge)
  })

  it('marks the nav item while an update is ready to download', async () => {
    vi.mocked(window.electronAPI.getUpdaterState).mockResolvedValue(
      updaterState({ status: 'available', availableVersion: '1.3.0' })
    )

    render(<UpdatesNavBadge />)

    expect(await screen.findByTestId('updates-nav-badge')).toBeInTheDocument()
  })

  it('marks the nav item while an update waits to install', async () => {
    vi.mocked(window.electronAPI.getUpdaterState).mockResolvedValue(
      updaterState({ status: 'downloaded', availableVersion: '1.3.0' })
    )

    render(<UpdatesNavBadge />)

    expect(await screen.findByTestId('updates-nav-badge')).toBeInTheDocument()
  })

  it('stays empty while the updater is idle', async () => {
    vi.mocked(window.electronAPI.getUpdaterState).mockResolvedValue(updaterState())

    render(<UpdatesNavBadge />)
    await act(async () => {})

    expect(screen.queryByTestId('updates-nav-badge')).toBeNull()
  })

  it('stays empty when the last check failed', async () => {
    vi.mocked(window.electronAPI.getUpdaterState).mockResolvedValue(
      updaterState({ status: 'error', errorMessage: 'cannot reach the update server' })
    )

    render(<UpdatesNavBadge />)
    await act(async () => {})

    expect(screen.queryByTestId('updates-nav-badge')).toBeNull()
  })

  it('clears the nav mark once the app is up to date again', async () => {
    let pushState: ((state: UpdaterState) => void) | null = null
    vi.mocked(window.electronAPI.onUpdaterStateChanged).mockImplementation((callback) => {
      pushState = callback
      return () => {}
    })
    vi.mocked(window.electronAPI.getUpdaterState).mockResolvedValue(
      updaterState({ status: 'downloaded', availableVersion: '1.3.0' })
    )

    render(<UpdatesNavBadge />)
    await screen.findByTestId('updates-nav-badge')

    act(() => {
      pushState?.(updaterState({ status: 'up-to-date' }))
    })

    expect(screen.queryByTestId('updates-nav-badge')).toBeNull()
  })

  it('renders read-only with the reason when the build cannot update itself', async () => {
    await renderUpdates(
      updaterState({
        supported: false,
        unsupportedReason: 'Automatic updates are switched off in this build.'
      })
    )

    expect(
      versionRow().getByText('Automatic updates are switched off in this build.')
    ).toBeInTheDocument()
    expect(versionRow().queryByRole('button')).toBeNull()
    expect(channelSelect()).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: 'Download updates in the background' })
    ).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Install when I quit' })).toBeDisabled()
  })
})
