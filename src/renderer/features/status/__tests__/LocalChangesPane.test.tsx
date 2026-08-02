import { AbortOperation, DiscardAll, GetIdentity, SetIdentity } from '@shared/rpc'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '@/app/WorkspaceContext'
import { useDialogs } from '@/components/ui/prompt-dialog'
import { LocalChangesPane } from '@/features/status/LocalChangesPane'
import { useGitActions } from '@/hooks/git/useGitActions'
import { useStashes } from '@/hooks/git/useStashes'
import { GitStoreProvider, type RepoSession, useActionRunner, useRepoSession } from '@/stores/git'
import type { GitStatus } from '@/types'
import { openedRepoResponse, statusResponse } from '../../../../test/builders'
import { renderWithQuery } from '../../../../test/render-app'
import { setupLogStream, sidecarMock } from '../../../../test/setup'

const repoPath = '/home/user/project'

const modified = (path: string) => ({ path, index: ' ', working_dir: 'M' })

function mockStatus(overrides: Partial<GitStatus> = {}) {
  sidecarMock.getStatus.mockResolvedValue(
    statusResponse({ files: [modified('a.ts'), modified('b.ts')], ...overrides })
  )
}

function Harness(props: { onSession: (session: RepoSession) => void }) {
  const session = useRepoSession()
  const actionRunner = useActionRunner()
  const actions = useGitActions(actionRunner)
  const stashList = useStashes(session.repoPath)
  const { prompt, confirm, dialogs } = useDialogs()
  props.onSession(session)

  return (
    <WorkspaceProvider value={{ actions, stashList, prompt, confirm }}>
      <LocalChangesPane currentBranch="main" />
      {dialogs}
    </WorkspaceProvider>
  )
}

async function renderLocalChanges(
  settle: () => Promise<unknown> = () => screen.findByRole('button', { name: 'a.ts' })
) {
  let session: RepoSession | undefined
  renderWithQuery(() => (
    <GitStoreProvider tabId="local-changes-test" tabActive={true}>
      <Harness
        onSession={(value) => {
          session = value
        }}
      />
    </GitStoreProvider>
  ))
  if (!session) {
    throw new Error('git store not initialized')
  }
  const repoSession = session
  await act(async () => {
    await repoSession.openRepo(repoPath)
  })
  await settle()
}

beforeEach(() => {
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openedRepoResponse(repoPath))
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  setupLogStream()
  mockStatus()
  sidecarMock.getDiff.mockResolvedValue({ _tag: 'Ok', patch: '', binary: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocalChangesPane', () => {
  it('shows the file list, the diff and the commit box side by side', async () => {
    await renderLocalChanges()

    expect(screen.getByRole('button', { name: 'a.ts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'b.ts' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toBeInTheDocument()
  })

  it('offers no files-or-diff pane toggle, because both are on screen', async () => {
    await renderLocalChanges()

    expect(screen.queryByRole('button', { name: 'Files' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Diff' })).not.toBeInTheDocument()
  })

  it('keeps the conflict banner above both panes', async () => {
    mockStatus({
      conflicted: ['a.ts'],
      files: [{ path: 'a.ts', index: 'U', working_dir: 'U' }, modified('b.ts')]
    })
    await renderLocalChanges()

    expect(await screen.findByTestId('conflict-bar')).toHaveTextContent(
      '1 merge conflict — resolve a.ts, then stage it to continue.'
    )
  })

  it('blocks the commit while a conflict is unresolved and says so', async () => {
    mockStatus({
      conflicted: ['a.ts'],
      files: [{ path: 'a.ts', index: 'U', working_dir: 'U' }, modified('b.ts')]
    })
    await renderLocalChanges()

    fireEvent.input(screen.getByRole('textbox', { name: 'Commit message' }), {
      target: { value: 'a message' }
    })

    expect(
      screen.getByText('Resolve and stage every conflicted file before committing.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
  })

  it('keeps stashing and discarding reachable from the files pane', async () => {
    await renderLocalChanges()

    expect(screen.getByRole('button', { name: 'Discard all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stash' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More stash options' })).toBeInTheDocument()
  })
})

describe('a repository git has no identity for', () => {
  const staged = (path: string) => ({ path, index: 'M', working_dir: ' ' })

  function mockIdentity(effective: { name?: string; email?: string }) {
    const current = { effective }
    sidecarMock.respond(GetIdentity, () => ({
      _tag: 'Ok',
      local: {},
      global: {},
      effective: current.effective
    }))
    return current
  }

  async function renderWithStagedChange(effective: { name?: string; email?: string }) {
    mockStatus({ files: [staged('a.ts')] })
    const identity = mockIdentity(effective)
    await renderLocalChanges()
    fireEvent.input(screen.getByRole('textbox', { name: 'Commit message' }), {
      target: { value: 'a message' }
    })
    return identity
  }

  it('offers the inline fix and blocks the commit until the identity is saved', async () => {
    const identity = await renderWithStagedChange({})
    const writes: unknown[] = []
    sidecarMock.respond(SetIdentity, (payload) => {
      writes.push(payload)
      identity.effective = { name: payload.name, email: payload.email }
      return { _tag: 'Ok' }
    })

    const callout = await screen.findByTestId('missing-identity-callout')
    expect(screen.getByRole('button', { name: 'Commit 1 file' })).toBeDisabled()

    fireEvent.input(within(callout).getByLabelText('Name'), {
      target: { value: 'Ada Lovelace' }
    })
    fireEvent.input(within(callout).getByLabelText('Email'), {
      target: { value: 'ada@example.com' }
    })
    fireEvent.click(within(callout).getByRole('button', { name: 'Save identity' }))

    await waitFor(() => {
      expect(screen.queryByTestId('missing-identity-callout')).not.toBeInTheDocument()
    })
    expect(writes).toEqual([{ scope: 'global', name: 'Ada Lovelace', email: 'ada@example.com' }])
    expect(screen.getByRole('button', { name: 'Commit 1 file' })).toBeEnabled()
  })

  it('stays out of the way once git knows who the author is', async () => {
    await renderWithStagedChange({ name: 'Ada Lovelace', email: 'ada@example.com' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Commit 1 file' })).toBeEnabled()
    })
    expect(screen.queryByTestId('missing-identity-callout')).not.toBeInTheDocument()
  })
})

describe('amend during an in-progress operation', () => {
  const cherryPick = {
    kind: 'cherry-pick' as const,
    oursLabel: 'main',
    theirsLabel: 'abc1234 add the widget'
  }

  const streamedCommit = {
    hash: 'aaa1111',
    message: 'previous work',
    author_name: 'Tester',
    date: '2026-01-01',
    parents: [] as string[],
    refs: ''
  }

  async function renderWithHead(overrides: Partial<GitStatus>) {
    const logStream = setupLogStream()
    mockStatus(overrides)
    await renderLocalChanges()
    logStream.fire({ repoPath, commits: [streamedCommit] })
    logStream.fireDone(repoPath, false)
    return screen.getByRole('checkbox', { name: 'Amend last commit' })
  }

  it('disables the amend toggle while an operation is in progress and nothing is conflicted', async () => {
    const toggle = await renderWithHead({ operation: cherryPick })
    expect(toggle).toBeDisabled()
  })

  it('enables the amend toggle once no operation is in progress', async () => {
    const toggle = await renderWithHead({})
    expect(toggle).toBeEnabled()
  })
})

describe('an in-progress operation with no commits to amend', () => {
  const patchSeries = {
    kind: 'am' as const,
    oursLabel: 'main',
    theirsLabel: '0001-add-the-widget.patch'
  }

  it('keeps abort reachable when the working tree is clean and HEAD is unborn', async () => {
    const logStream = setupLogStream()
    mockStatus({ files: [], operation: patchSeries })

    await renderLocalChanges(() => screen.findByText('Applying patches'))
    logStream.fireDone(repoPath, false)

    expect(await screen.findByText('No changes left to resolve')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abort patch series' })).toBeEnabled()
  })
})

describe('discard all during an in-progress operation', () => {
  const mergeOperation = { kind: 'merge' as const, oursLabel: 'main', theirsLabel: 'feature' }

  it('names the abort in the confirm and aborts before discarding', async () => {
    mockStatus({ operation: mergeOperation })
    const rpcCalls: string[] = []
    sidecarMock.respond(AbortOperation, () => {
      rpcCalls.push('abortOperation')
      return { _tag: 'Ok' }
    })
    sidecarMock.respond(DiscardAll, () => {
      rpcCalls.push('discardAll')
      return { _tag: 'Ok' }
    })
    await renderLocalChanges()

    fireEvent.click(screen.getByRole('button', { name: 'Discard all' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Discard all changes?')
    expect(dialog).toHaveTextContent('the in-progress merge is aborted')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard all' }))
    await waitFor(() => expect(rpcCalls).toEqual(['abortOperation', 'discardAll']))
  })

  it('keeps the plain warning and skips the abort when nothing is in progress', async () => {
    mockStatus()
    const rpcCalls: string[] = []
    sidecarMock.respond(AbortOperation, () => {
      rpcCalls.push('abortOperation')
      return { _tag: 'Ok' }
    })
    sidecarMock.respond(DiscardAll, () => {
      rpcCalls.push('discardAll')
      return { _tag: 'Ok' }
    })
    await renderLocalChanges()

    fireEvent.click(screen.getByRole('button', { name: 'Discard all' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toHaveTextContent('aborted')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard all' }))
    await waitFor(() => expect(rpcCalls).toEqual(['discardAll']))
  })
})
