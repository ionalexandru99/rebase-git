import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GeneralContent } from '../GeneralSection'

const reopenCheckbox = () => screen.getByRole('checkbox', { name: 'Reopen repositories on launch' })

const rebaseRadio = () =>
  screen.getByRole('radio', { name: 'Replay your commits on top of theirs (rebase)' })

const mergeRadio = () =>
  screen.getByRole('radio', { name: 'Keep both lines of work and add a merge commit (merge)' })

const askRadio = () => screen.getByRole('radio', { name: 'Ask each time' })

describe('GeneralSection', () => {
  it('shows the stored reopen-on-launch preference', async () => {
    vi.mocked(window.electronAPI.getReopenRepositoriesOnLaunch).mockResolvedValue(false)

    render(<GeneralContent />)

    await waitFor(() => expect(reopenCheckbox()).toBeEnabled())
    expect(reopenCheckbox()).not.toBeChecked()
  })

  it('persists turning reopen-on-launch off', async () => {
    render(<GeneralContent />)
    await waitFor(() => expect(reopenCheckbox()).toBeEnabled())
    expect(reopenCheckbox()).toBeChecked()

    fireEvent.click(reopenCheckbox())

    expect(window.electronAPI.setReopenRepositoriesOnLaunch).toHaveBeenCalledWith(false)
    expect(reopenCheckbox()).not.toBeChecked()
  })

  it('shows the remembered diverged-pull strategy', async () => {
    vi.mocked(window.electronAPI.getPullDivergedStrategy).mockResolvedValue('rebase')

    render(<GeneralContent />)

    await waitFor(() => expect(rebaseRadio()).toBeChecked())
    expect(mergeRadio()).not.toBeChecked()
    expect(askRadio()).not.toBeChecked()
  })

  it('shows "Ask each time" when no strategy is remembered', async () => {
    render(<GeneralContent />)

    await waitFor(() => expect(askRadio()).toBeChecked())
  })

  it('persists a chosen strategy', async () => {
    render(<GeneralContent />)
    await waitFor(() => expect(mergeRadio()).toBeEnabled())

    fireEvent.click(mergeRadio())

    expect(window.electronAPI.setPullDivergedStrategy).toHaveBeenCalledWith('merge')
    expect(mergeRadio()).toBeChecked()
  })

  it('clears the remembered strategy when switching back to asking each time', async () => {
    vi.mocked(window.electronAPI.getPullDivergedStrategy).mockResolvedValue('merge')

    render(<GeneralContent />)
    await waitFor(() => expect(mergeRadio()).toBeChecked())

    fireEvent.click(askRadio())

    expect(window.electronAPI.setPullDivergedStrategy).toHaveBeenCalledWith(null)
    expect(askRadio()).toBeChecked()
    expect(mergeRadio()).not.toBeChecked()
  })
  it('rolls the reopen-on-launch control back when the save fails', async () => {
    vi.mocked(window.electronAPI.setReopenRepositoriesOnLaunch).mockRejectedValue(
      new Error('ipc down')
    )
    render(<GeneralContent />)
    await waitFor(() => expect(reopenCheckbox()).toBeEnabled())
    expect(reopenCheckbox()).toBeChecked()

    fireEvent.click(reopenCheckbox())

    await waitFor(() => expect(reopenCheckbox()).toBeChecked())
  })

  it('rolls the diverged-pull choice back when the save fails', async () => {
    vi.mocked(window.electronAPI.setPullDivergedStrategy).mockRejectedValue(new Error('ipc down'))
    render(<GeneralContent />)
    await waitFor(() => expect(askRadio()).toBeChecked())

    fireEvent.click(rebaseRadio())

    await waitFor(() => expect(askRadio()).toBeChecked())
    expect(rebaseRadio()).not.toBeChecked()
  })
})
