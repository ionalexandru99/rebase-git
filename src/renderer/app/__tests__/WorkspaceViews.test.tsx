import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '@/app/WorkspaceContext'
import { WorkspaceViewRenderer } from '@/app/WorkspaceViews'
import { useDialogs } from '@/components/ui/prompt-dialog'
import { useGitActions } from '@/hooks/git/useGitActions'
import { useStashes } from '@/hooks/git/useStashes'
import { COMPACT_MEDIA_QUERY } from '@/lib/breakpoints'
import { GitStoreProvider, type RepoSession, useActionRunner, useRepoSession } from '@/stores/git'
import type { GitStatus } from '@/types'
import { renderWithQuery } from '../../../test/render-app'
import { setupLogStream, sidecarMock } from '../../../test/setup'

const repoPath = '/home/user/project'

interface ViewportController {
  compactQuery: MediaQueryList
  setCompact: (compact: boolean) => void
}

function installViewport(initialCompact: boolean): ViewportController {
  let compact = initialCompact
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const compactQuery = {
    get matches() {
      return compact
    },
    media: COMPACT_MEDIA_QUERY,
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  } as MediaQueryList
  const otherQuery = { ...compactQuery, matches: false } as MediaQueryList
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    query === COMPACT_MEDIA_QUERY ? compactQuery : otherQuery
  )
  return {
    compactQuery,
    setCompact(nextCompact) {
      compact = nextCompact
      const event = { matches: nextCompact, media: COMPACT_MEDIA_QUERY } as MediaQueryListEvent
      act(() => {
        for (const listener of listeners) {
          listener(event)
        }
      })
    }
  }
}

const modified = (path: string) => ({ path, index: ' ', working_dir: 'M' })

function mockStatus(overrides: Partial<GitStatus> = {}) {
  sidecarMock.getStatus.mockResolvedValue({
    _tag: 'Ok',
    status: {
      current: 'main',
      modified: [],
      staged: [],
      not_added: [],
      conflicted: [],
      deleted: [],
      created: [],
      renamed: [],
      files: [modified('a.ts'), modified('b.ts')],
      ...overrides
    }
  })
}

const localChangesProps = {
  repoPath,
  remotes: {},
  currentBranch: 'main',
  remoteBranches: [],
  visibleBranchRefs: new Set<string>(),
  filteredCommits: [],
  displayedCommitSet: new Set<string>(),
  expandedMerges: new Set<string>(),
  filter: '',
  onFilterChange: () => {},
  visibleSet: null,
  tabActive: true
}

function LocalChangesHarness(props: { onSession: (session: RepoSession) => void }) {
  const session = useRepoSession()
  const actionRunner = useActionRunner()
  const actions = useGitActions(actionRunner)
  const stashList = useStashes(session.repoPath)
  const { prompt, confirm, dialogs } = useDialogs()
  props.onSession(session)

  return (
    <WorkspaceProvider value={{ actions, stashList, prompt, confirm }}>
      <WorkspaceViewRenderer activeView="local-changes" {...localChangesProps} />
      {dialogs}
    </WorkspaceProvider>
  )
}

async function renderLocalChanges(
  settle: () => Promise<unknown> = () => screen.findByRole('button', { name: 'a.ts' })
) {
  let session: RepoSession | undefined
  renderWithQuery(() => (
    <GitStoreProvider tabId="workspace-views-test" tabActive={true}>
      <LocalChangesHarness
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

function elementAfter(element: Element): HTMLElement {
  const sibling = element.nextElementSibling
  if (!(sibling instanceof HTMLElement)) {
    throw new Error('expected a sibling element')
  }
  return sibling
}

function compactPanes() {
  const toggleBar = screen.getByRole('button', { name: 'Files' }).parentElement
  if (!toggleBar) {
    throw new Error('compact pane toggle is not rendered')
  }
  const filesPane = elementAfter(toggleBar)
  return { filesPane, diffPane: elementAfter(filesPane) }
}

const isHidden = (pane: HTMLElement) => pane.classList.contains('hidden')

beforeEach(() => {
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
    _tag: 'Ok',
    result: { path: repoPath, remotes: {}, defaultBranch: 'main' }
  })
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  setupLogStream()
  mockStatus()
  sidecarMock.getDiff.mockResolvedValue({
    _tag: 'Ok',
    patch: '',
    diff: { filePath: 'a.ts', binary: false, hunks: [] }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocalChangesView compact mode', () => {
  it('splits files and diff behind a toggle at compact widths', async () => {
    installViewport(true)
    await renderLocalChanges()

    const filesToggle = screen.getByRole('button', { name: 'Files' })
    const diffToggle = screen.getByRole('button', { name: 'Diff' })
    expect(filesToggle).toHaveAttribute('aria-pressed', 'true')
    expect(isHidden(compactPanes().filesPane)).toBe(false)
    expect(isHidden(compactPanes().diffPane)).toBe(true)

    fireEvent.click(diffToggle)

    expect(diffToggle).toHaveAttribute('aria-pressed', 'true')
    expect(filesToggle).toHaveAttribute('aria-pressed', 'false')
    expect(isHidden(compactPanes().filesPane)).toBe(true)
    expect(isHidden(compactPanes().diffPane)).toBe(false)

    fireEvent.click(filesToggle)

    expect(isHidden(compactPanes().filesPane)).toBe(false)
    expect(isHidden(compactPanes().diffPane)).toBe(true)
  })

  it('shows both panes without a toggle above the compact width', async () => {
    installViewport(false)
    await renderLocalChanges()

    expect(screen.queryByRole('button', { name: 'Files' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Diff' })).not.toBeInTheDocument()
  })

  it('reveals the diff pane when a worktree file is selected', async () => {
    installViewport(true)
    await renderLocalChanges()

    fireEvent.click(screen.getByRole('button', { name: 'b.ts' }))

    expect(screen.getByRole('button', { name: 'Diff' })).toHaveAttribute('aria-pressed', 'true')
    expect(isHidden(compactPanes().diffPane)).toBe(false)
    expect(isHidden(compactPanes().filesPane)).toBe(true)
  })

  it('keeps the conflict banner outside both compact panes', async () => {
    installViewport(true)
    mockStatus({
      conflicted: ['a.ts'],
      files: [{ path: 'a.ts', index: 'U', working_dir: 'U' }, modified('b.ts')]
    })
    await renderLocalChanges()

    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent('1 merge conflict')
    const { filesPane, diffPane } = compactPanes()
    expect(filesPane).not.toContainElement(banner)
    expect(diffPane).not.toContainElement(banner)

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }))

    expect(screen.getByRole('status')).toBe(banner)
    expect(isHidden(compactPanes().diffPane)).toBe(false)
  })

  it('returns to the files pane after leaving compact width', async () => {
    const viewport = installViewport(true)
    await renderLocalChanges()

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }))
    expect(screen.getByRole('button', { name: 'Diff' })).toHaveAttribute('aria-pressed', 'true')

    viewport.setCompact(false)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Diff' })).not.toBeInTheDocument()
    })

    viewport.setCompact(true)

    expect(await screen.findByRole('button', { name: 'Files' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(isHidden(compactPanes().filesPane)).toBe(false)
    expect(isHidden(compactPanes().diffPane)).toBe(true)
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
    installViewport(false)
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
    installViewport(false)
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
    installViewport(false)
    mockStatus({ operation: mergeOperation })
    const rpcCalls: string[] = []
    sidecarMock.respond('abortOperation', () => {
      rpcCalls.push('abortOperation')
      return { _tag: 'Ok' }
    })
    sidecarMock.respond('discardAll', () => {
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
    installViewport(false)
    mockStatus()
    const rpcCalls: string[] = []
    sidecarMock.respond('abortOperation', () => {
      rpcCalls.push('abortOperation')
      return { _tag: 'Ok' }
    })
    sidecarMock.respond('discardAll', () => {
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
