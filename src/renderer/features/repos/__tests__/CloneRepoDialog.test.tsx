import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloneRepoDialog } from '../CloneRepoDialog'

const cloneStore = vi.hoisted(() => ({
  cloning: false,
  progress: null as { phase: string; percent?: number } | null,
  error: null as string | null,
  clone:
    vi.fn<
      (request: { url: string; parentDir: string; folderName: string }) => Promise<string | null>
    >(),
  cancel: vi.fn(),
  reset: vi.fn()
}))

vi.mock('../useCloneRepo', () => ({
  useCloneRepo: () => cloneStore
}))

function renderDialog(overrides: Partial<Parameters<typeof CloneRepoDialog>[0]> = {}) {
  const onSelectParentDir = overrides.onSelectParentDir ?? vi.fn().mockResolvedValue(null)
  const onCloned = overrides.onCloned ?? vi.fn()
  const onClose = overrides.onClose ?? vi.fn()
  render(
    <CloneRepoDialog
      defaultParentDir={
        overrides.defaultParentDir === undefined ? '/work' : overrides.defaultParentDir
      }
      onSelectParentDir={onSelectParentDir}
      onCloned={onCloned}
      onClose={onClose}
    />
  )
  return { onSelectParentDir, onCloned, onClose }
}

beforeEach(() => {
  cloneStore.cloning = false
  cloneStore.progress = null
  cloneStore.error = null
  cloneStore.clone.mockReset().mockResolvedValue(null)
  cloneStore.cancel.mockReset()
  cloneStore.reset.mockReset()
})

describe('CloneRepoDialog', () => {
  it('derives a clone request and reports the created repository', async () => {
    cloneStore.clone.mockResolvedValue('/work/app')
    const { onCloned } = renderDialog()

    fireEvent.input(screen.getByRole('textbox', { name: 'Repository URL' }), {
      target: { value: '  https://github.com/acme/app.git  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))

    await waitFor(() =>
      expect(cloneStore.clone).toHaveBeenCalledWith({
        url: 'https://github.com/acme/app.git',
        parentDir: '/work',
        folderName: 'app'
      })
    )
    await waitFor(() => expect(onCloned).toHaveBeenCalledWith('/work/app'))
    expect(cloneStore.reset).toHaveBeenCalledOnce()
  })

  it('updates the destination from the async folder picker', async () => {
    const onSelectParentDir = vi.fn().mockResolvedValue('/other')
    renderDialog({ onSelectParentDir })

    fireEvent.click(screen.getByRole('button', { name: 'Change…' }))

    expect(await screen.findByText('/other')).toBeInTheDocument()
  })

  it('cancels an active clone without closing the dialog', () => {
    cloneStore.cloning = true
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(cloneStore.cancel).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from cancel or dismissal while idle', () => {
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(2)
    expect(cloneStore.cancel).not.toHaveBeenCalled()
  })
})
