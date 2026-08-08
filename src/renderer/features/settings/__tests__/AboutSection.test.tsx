import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AboutContent } from '../AboutSection'

const EXPECTED_BUILD_LINE = 'Rebase 1.0.0 (abcdef1) · Electron 37.2.0 · darwin-arm64'

const buildRow = () => within(screen.getByRole('group', { name: 'Build' }))

async function renderAbout() {
  render(<AboutContent />)
  await waitFor(() => expect(screen.getByText(EXPECTED_BUILD_LINE)).toBeInTheDocument())
}

describe('AboutSection', () => {
  it('renders the build metadata on one line', async () => {
    await renderAbout()

    expect(buildRow().getByText(EXPECTED_BUILD_LINE)).toBeInTheDocument()
  })

  it('copies the build line to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderAbout()

    fireEvent.click(buildRow().getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(EXPECTED_BUILD_LINE)
    await waitFor(() =>
      expect(buildRow().getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    )
  })

  it('reveals the logs folder in the file manager', async () => {
    await renderAbout()

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Logs' })).getByRole('button', {
        name: 'Show logs folder'
      })
    )

    expect(window.electronAPI.revealLogsFolder).toHaveBeenCalledOnce()
  })

  it('opens the release notes for this version', async () => {
    await renderAbout()

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Release notes' })).getByRole('button', {
        name: 'Open release notes'
      })
    )

    expect(window.electronAPI.openReleaseNotes).toHaveBeenCalledOnce()
  })
})
