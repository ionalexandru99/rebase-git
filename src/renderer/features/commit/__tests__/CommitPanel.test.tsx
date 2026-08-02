import { GetIdentity } from '@shared/rpc'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient, QueryProvider } from '@/app/QueryProvider'
import { sidecarMock } from '../../../../test/setup'
import { CommitPanel } from '../CommitPanel'

const REPO = '/home/user/project'

function panelElement(overrides: Partial<Parameters<typeof CommitPanel>[0]> = {}) {
  return (
    <CommitPanel
      repoPath={overrides.repoPath ?? REPO}
      onCommit={overrides.onCommit ?? vi.fn().mockResolvedValue(true)}
      onAmend={overrides.onAmend ?? vi.fn().mockResolvedValue(true)}
      loadHeadMessage={overrides.loadHeadMessage ?? vi.fn().mockResolvedValue('head message')}
      amendAvailable={overrides.amendAvailable ?? false}
      amendDisabled={overrides.amendDisabled ?? false}
      loading={overrides.loading ?? false}
      branch={overrides.branch ?? 'main'}
      stagedCount={overrides.stagedCount ?? 2}
      onAmendChange={overrides.onAmendChange}
      droppedHeadPaths={overrides.droppedHeadPaths}
      droppedHeadHunks={overrides.droppedHeadHunks}
      expectedHead={overrides.expectedHead}
      prefillMessage={overrides.prefillMessage}
      concludesMerge={overrides.concludesMerge}
      commitBlockedReason={overrides.commitBlockedReason}
    />
  )
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
    {children}
  </QueryProvider>
)

function renderPanel(
  overrides: Partial<Parameters<typeof CommitPanel>[0]> = {}
): ReturnType<typeof render> {
  return render(panelElement(overrides), { wrapper })
}

const amendToggle = () => screen.getByRole('checkbox', { name: /amend last commit/i })

describe('CommitPanel', () => {
  it('does not commit on Enter, which types a newline instead', () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    renderPanel({ onCommit })
    const textarea = screen.getByRole('textbox')
    fireEvent.input(textarea, { target: { value: 'a message' } })

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onCommit).not.toHaveBeenCalled()
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

  it('submits only once when the commit button is clicked twice before loading renders', async () => {
    let resolveCommit: (success: boolean) => void = () => {}
    const onCommit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCommit = resolve
        })
    )
    renderPanel({ onCommit })
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'one commit' } })
    const button = screen.getByRole('button', { name: /Commit 2 files/i })

    fireEvent.click(button)
    fireEvent.click(button)

    expect(onCommit).toHaveBeenCalledTimes(1)
    await act(async () => resolveCommit(true))
  })

  it('preserves a newer draft when an earlier commit succeeds', async () => {
    let resolveCommit: (success: boolean) => void = () => {}
    const onCommit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCommit = resolve
        })
    )
    renderPanel({ onCommit })
    const textarea = screen.getByRole('textbox')
    fireEvent.input(textarea, { target: { value: 'submitted draft' } })
    fireEvent.click(screen.getByRole('button', { name: /Commit 2 files/i }))
    fireEvent.input(textarea, { target: { value: 'next draft' } })

    await act(async () => resolveCommit(true))

    expect(textarea).toHaveValue('next draft')
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

  it('does not overwrite text edited while the amend message is loading', async () => {
    let resolveHeadMessage: (message: string) => void = () => {}
    const loadHeadMessage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveHeadMessage = resolve
        })
    )
    renderPanel({ amendAvailable: true, loadHeadMessage })
    const textarea = screen.getByRole('textbox')

    fireEvent.click(amendToggle())
    fireEvent.input(textarea, { target: { value: 'edited amend message' } })
    await act(async () => resolveHeadMessage('stale head message'))

    expect(textarea).toHaveValue('edited amend message')
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
      expectedHead: 'head-sha',
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))

    expect(screen.getByRole('button', { name: 'Amend' })).toBeEnabled()
  })

  it('keeps Amend disabled until the rendered HEAD SHA is available', async () => {
    renderPanel({
      amendAvailable: true,
      stagedCount: 0,
      expectedHead: undefined,
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))

    expect(screen.getByRole('button', { name: 'Amend' })).toBeDisabled()
  })

  it('invokes onAmend (not onCommit) when committing in amend mode', async () => {
    const onAmend = vi.fn().mockResolvedValue(true)
    const onCommit = vi.fn().mockResolvedValue(true)
    renderPanel({
      amendAvailable: true,
      stagedCount: 0,
      onAmend,
      onCommit,
      expectedHead: 'head-sha',
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))
    fireEvent.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() => expect(onAmend).toHaveBeenCalledWith('head message', [], [], 'head-sha'))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('forwards the assembled droppedHeadPaths and droppedHeadHunks into onAmend', async () => {
    const onAmend = vi.fn().mockResolvedValue(true)
    renderPanel({
      amendAvailable: true,
      stagedCount: 0,
      onAmend,
      expectedHead: 'head-sha',
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
        [{ file: 'partial.ts', hunks: ['@@ -1,3 +1,4 @@'] }],
        'head-sha'
      )
    )
  })

  it('warns that dropped files also exclude their staged changes', async () => {
    renderPanel({
      amendAvailable: true,
      expectedHead: 'head-sha',
      droppedHeadPaths: ['src/dropped.ts'],
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())

    expect(
      await screen.findByText(/staged changes in dropped files will also be excluded/i)
    ).toBeInTheDocument()
  })

  it('forwards the expectedHead sha the panel rendered against into onAmend', async () => {
    const onAmend = vi.fn().mockResolvedValue(true)
    renderPanel({
      amendAvailable: true,
      stagedCount: 0,
      onAmend,
      expectedHead: 'abc123',
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))
    fireEvent.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() => expect(onAmend).toHaveBeenCalledWith('head message', [], [], 'abc123'))
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
      expectedHead: 'head-sha',
      loadHeadMessage: vi.fn().mockResolvedValue('head message')
    })

    fireEvent.click(amendToggle())
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('head message'))
    fireEvent.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() => expect(onAmendChange).toHaveBeenLastCalledWith(false))
  })

  it('prefills the merge message into an untouched box', () => {
    renderPanel({ prefillMessage: "Merge branch 'feature/login'" })
    expect(screen.getByRole('textbox')).toHaveValue("Merge branch 'feature/login'")
  })

  it('does not clobber a message the user already typed', () => {
    const view = renderPanel()
    const textarea = screen.getByRole('textbox')
    fireEvent.input(textarea, { target: { value: 'my own message' } })

    view.rerender(panelElement({ prefillMessage: "Merge branch 'feature/login'" }))

    expect(textarea).toHaveValue('my own message')
  })

  it('drops the prefill again when the operation is aborted', () => {
    const view = renderPanel({ prefillMessage: "Merge branch 'feature/login'" })
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue("Merge branch 'feature/login'")

    view.rerender(panelElement({ prefillMessage: undefined }))

    expect(textarea).toHaveValue('')
  })
})

describe('CommitPanel identity gate', () => {
  const identityResponder = (effective: { name?: string; email?: string }) => {
    const current = { effective }
    sidecarMock.respond(GetIdentity, () => ({
      _tag: 'Ok',
      local: {},
      global: {},
      effective: current.effective
    }))
    return current
  }

  it('raises the callout and holds the commit while git has no identity', async () => {
    identityResponder({})
    renderPanel()
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'a message' } })

    expect(await screen.findByTestId('missing-identity-callout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Commit 2 files/i })).toBeDisabled()
  })

  it('re-reads the identity after a rejected commit, so the backstop error lands on the inline fix', async () => {
    const identity = identityResponder({ name: 'Ada Lovelace', email: 'ada@example.com' })
    const onCommit = vi.fn().mockImplementation(async () => {
      identity.effective = {}
      return false
    })
    renderPanel({ onCommit })
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'a message' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Commit 2 files/i })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /Commit 2 files/i }))

    expect(await screen.findByTestId('missing-identity-callout')).toBeInTheDocument()
  })
})
