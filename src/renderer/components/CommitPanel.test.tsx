import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommitPanel } from '@/components/CommitPanel'

describe('CommitPanel', () => {
  it('renders the title and an empty textarea', () => {
    render(<CommitPanel onCommit={vi.fn().mockResolvedValue(true)} loading={false} />)

    expect(screen.getByText('Commit')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('disables Commit Changes when the message is empty', () => {
    render(<CommitPanel onCommit={vi.fn().mockResolvedValue(true)} loading={false} />)

    expect(screen.getByRole('button', { name: /Commit Changes/i })).toBeDisabled()
  })

  it('disables Commit Changes while the loading prop is true', () => {
    render(<CommitPanel onCommit={vi.fn().mockResolvedValue(true)} loading={true} />)

    expect(screen.getByRole('button', { name: /Committing/i })).toBeDisabled()
  })

  it('invokes onCommit with the trimmed message and clears the textarea on success', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(<CommitPanel onCommit={onCommit} loading={false} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '  fix bug  ' } })

    fireEvent.click(screen.getByRole('button', { name: /Commit Changes/i }))

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('fix bug')
    })
    await waitFor(() => {
      expect(textarea.value).toBe('')
    })
  })

  it('keeps the message when onCommit returns false', async () => {
    const onCommit = vi.fn().mockResolvedValue(false)
    render(<CommitPanel onCommit={onCommit} loading={false} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'keep me' } })

    fireEvent.click(screen.getByRole('button', { name: /Commit Changes/i }))

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalled()
    })
    expect(textarea.value).toBe('keep me')
  })

  it('updates the subject-length counter as the user types', () => {
    render(<CommitPanel onCommit={vi.fn().mockResolvedValue(true)} loading={false} />)

    expect(screen.getByText(/0\/72/)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'short subject' } })
    expect(screen.getByText(/13\/72/)).toBeInTheDocument()
  })
})
