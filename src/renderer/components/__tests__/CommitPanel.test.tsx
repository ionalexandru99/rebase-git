import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommitPanel } from '../CommitPanel'

function renderPanel(
  overrides: Partial<Parameters<typeof CommitPanel>[0]> = {}
): ReturnType<typeof render> {
  return render(
    <CommitPanel
      onCommit={overrides.onCommit ?? vi.fn().mockResolvedValue(true)}
      onAmend={overrides.onAmend ?? vi.fn().mockResolvedValue(true)}
      loadHeadMessage={overrides.loadHeadMessage ?? vi.fn().mockResolvedValue('head message')}
      amendAvailable={overrides.amendAvailable ?? false}
      amendDisabled={overrides.amendDisabled ?? false}
      loading={overrides.loading ?? false}
      branch={overrides.branch ?? 'main'}
      stagedCount={overrides.stagedCount ?? 2}
      ahead={overrides.ahead}
      onAmendChange={overrides.onAmendChange}
      droppedHeadPaths={overrides.droppedHeadPaths}
      droppedHeadHunks={overrides.droppedHeadHunks}
    />
  )
}

const amendToggle = () => screen.getByRole('checkbox', { name: /amend last commit/i })

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

  it('prefills HEAD’s full message and relabels the button to Amend when amend is ticked', async () => {
    const loadHeadMessage = vi.fn().mockResolvedValue('original subject\n\noriginal body')
    renderPanel({ amendAvailable: true, loadHeadMessage })

    fireEvent.click(amendToggle())

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('original subject\n\noriginal body')
    })
    expect(screen.getByRole('button', { name: 'Amend' })).toBeInTheDocument()
    expect(loadHeadMessage).toHaveBeenCalledTimes(1)
  })

  it('restores the prior draft message when amend is un-ticked', async () => {
    renderPanel({
      amendAvailable: true,
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'my draft' } })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(textarea.value).toBe('head message'))

    fireEvent.click(amendToggle())
    expect(textarea.value).toBe('my draft')
    expect(screen.getByRole('button', { name: /Commit/ })).toBeInTheDocument()
  })

  it('enables the Amend button with nothing staged (pure reword)', async () => {
    renderPanel({
      amendAvailable: true,
      stagedCount: 0,
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))

    expect(screen.getByRole('button', { name: 'Amend' })).toBeEnabled()
  })

  it('invokes onAmend (not onCommit) when committing in amend mode', async () => {
    const onAmend = vi.fn().mockResolvedValue(true)
    const onCommit = vi.fn().mockResolvedValue(true)
    renderPanel({
      amendAvailable: true,
      stagedCount: 0,
      onAmend,
      onCommit,
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))
    fireEvent.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() => expect(onAmend).toHaveBeenCalledWith('head message', [], []))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('forwards the assembled droppedHeadPaths and droppedHeadHunks into onAmend', async () => {
    const onAmend = vi.fn().mockResolvedValue(true)
    renderPanel({
      amendAvailable: true,
      stagedCount: 0,
      onAmend,
      droppedHeadPaths: ['src/dropped.ts', 'gone.txt'],
      droppedHeadHunks: [{ file: 'partial.ts', hunks: ['@@ -1,3 +1,4 @@'] }],
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))
    fireEvent.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() =>
      expect(onAmend).toHaveBeenCalledWith(
        'head message',
        ['src/dropped.ts', 'gone.txt'],
        [{ file: 'partial.ts', hunks: ['@@ -1,3 +1,4 @@'] }]
      )
    )
  })

  it('hides the amend toggle when there is no HEAD to amend', () => {
    renderPanel({ amendAvailable: false })
    expect(screen.queryByRole('checkbox', { name: /amend last commit/i })).not.toBeInTheDocument()
  })

  it('disables the amend toggle when conflicts are present', () => {
    renderPanel({ amendAvailable: true, amendDisabled: true })
    expect(amendToggle()).toBeDisabled()
  })

  it('offers the amend toggle when available and unconflicted (e.g. detached HEAD)', () => {
    renderPanel({ amendAvailable: true, amendDisabled: false, branch: 'HEAD' })
    expect(amendToggle()).toBeEnabled()
  })

  it('reports amend state to onAmendChange as the toggle flips', async () => {
    const onAmendChange = vi.fn()
    renderPanel({
      amendAvailable: true,
      onAmendChange,
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(onAmendChange).toHaveBeenLastCalledWith(true))

    fireEvent.click(amendToggle())
    expect(onAmendChange).toHaveBeenLastCalledWith(false)
  })

  it('reports amend cleared to onAmendChange after a successful amend', async () => {
    const onAmendChange = vi.fn()
    renderPanel({
      amendAvailable: true,
      stagedCount: 0,
      onAmendChange,
      onAmend: vi.fn().mockResolvedValue(true),
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))
    fireEvent.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() => expect(onAmendChange).toHaveBeenLastCalledWith(false))
  })

  it('updates the subject-length counter as the user types', () => {
    renderPanel()

    expect(screen.getByText(/0 \/ 72/)).toBeInTheDocument()

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'short subject' } })
    expect(screen.getByText(/13 \/ 72/)).toBeInTheDocument()
  })
})
