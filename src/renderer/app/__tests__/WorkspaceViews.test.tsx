import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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
  const { prompt, confirm } = useDialogs()
  props.onSession(session)

  return (
    <WorkspaceProvider value={{ actions, stashList, prompt, confirm }}>
      <WorkspaceViewRenderer activeView="local-changes" {...localChangesProps} />
    </WorkspaceProvider>
  )
}

async function renderLocalChanges() {
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
  await screen.findByRole('button', { name: 'a.ts' })
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
