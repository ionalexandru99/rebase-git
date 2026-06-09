import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommitPanel } from '../CommitPanel'

function renderPanel(
  overrides: Partial<Parameters<typeof CommitPanel>[0]> = {}
): ReturnType<typeof render> {
  return render(
    <CommitPanel
      onCommit={overrides.onCommit ?? vi.fn().mockResolvedValue(true)}
      loading={overrides.loading ?? false}
      branch={overrides.branch ?? 'main'}
      stagedCount={overrides.stagedCount ?? 2}
      ahead={overrides.ahead}
    />
  )
}

describe('CommitPanel', () => {
  it('renders an empty textarea and the branch chip', () => {
    renderPanel({ branch: 'feature/ui' })

    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByText('feature/ui')).toBeInTheDocument()
  })

  it('labels the commit button with the staged count', () => {
    renderPanel({ stagedCount: 4 })
    expect(screen.getByRole('button', { name: 'Commit 4 files' })).toBeInTheDocument()
  })

  it('disables commit when the message is empty', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /Commit 2 files/i })).toBeDisabled()
  })

  it('disables commit when nothing is staged', () => {
    renderPanel({ stagedCount: 0 })
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'message' } })
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
  })

  it('disables commit while the loading prop is true', () => {
    renderPanel({ loading: true })
    expect(screen.getByRole('button', { name: /Committing/i })).toBeDisabled()
  })

  it('shows the staged and ahead chips', () => {
    renderPanel({ stagedCount: 4, ahead: 2 })
    expect(screen.getByText('4 staged')).toBeInTheDocument()
    expect(screen.getByText('↑2')).toBeInTheDocument()
  })

  it('invokes onCommit with the trimmed message and clears the textarea on success', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    renderPanel({ onCommit })

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: '  fix bug  ' } })

    fireEvent.click(screen.getByRole('button', { name: /Commit 2 files/i }))

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('fix bug')
    })
    await waitFor(() => {
      expect(textarea.value).toBe('')
    })
  })

  it('keeps the message when onCommit returns false', async () => {
    const onCommit = vi.fn().mockResolvedValue(false)
    renderPanel({ onCommit })

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'keep me' } })

    fireEvent.click(screen.getByRole('button', { name: /Commit 2 files/i }))

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalled()
    })
    expect(textarea.value).toBe('keep me')
  })

  it('updates the subject-length counter as the user types', () => {
    renderPanel()

    expect(screen.getByText(/0 \/ 72/)).toBeInTheDocument()

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'short subject' } })
    expect(screen.getByText(/13 \/ 72/)).toBeInTheDocument()
  })
})
