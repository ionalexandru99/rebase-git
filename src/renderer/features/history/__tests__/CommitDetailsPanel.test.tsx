import type { CommitDetail } from '@shared/schemas/git'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refFilterKey } from '@/features/history/selectors'
import { GitStoreProvider, type RepoSession, useRepoSession } from '@/stores/git'
import type { GitLog, GitLogEntry } from '@/types'
import { renderWithQuery } from '../../../../test/render-app'
import { setupLogStream, sidecarMock } from '../../../../test/setup'
import { HistoryPanel } from '..'

const repoPath = '/home/user/project'

function entry(overrides: Partial<GitLogEntry> & Pick<GitLogEntry, 'hash'>): GitLogEntry {
  return {
    message: 'msg',
    author_name: 'Ada Author',
    date: '2026-07-21T09:42:00.000Z',
    parents: [],
    refs: '',
    ...overrides
  }
}

const log: GitLog = {
  all: [
    entry({
      hash: 'aaaaaaa1',
      message: 'newest change',
      refs: 'HEAD -> main',
      parents: ['bbbbbbb2']
    }),
    entry({ hash: 'bbbbbbb2', message: 'middle change', parents: ['ccccccc3'] }),
    entry({ hash: 'ccccccc3', message: 'oldest change', parents: [] })
  ],
  loadedCount: 3
}

function detailFor(sha: string, overrides: Partial<CommitDetail> = {}): CommitDetail {
  return {
    sha,
    parents: ['bbbbbbb2'],
    author: { name: 'Ada Author', email: 'ada@example.com' },
    authorDate: '2026-07-21T09:42:00.000Z',
    committer: { name: 'Ada Author', email: 'ada@example.com' },
    commitDate: '2026-07-21T09:42:00.000Z',
    subject: 'newest change',
    body: 'Why this change was needed.',
    files: [
      { path: 'README.md', status: 'M', additions: 1, deletions: 0, binary: false },
      { path: 'src/deep/alpha.ts', status: 'M', additions: 3, deletions: 1, binary: false },
      { path: 'src/deep/beta.ts', status: 'A', additions: 5, deletions: 0, binary: false }
    ],
    ...overrides
  }
}

const diffFor = (file: string) => ({
  _tag: 'Ok' as const,
  diff: {
    filePath: file,
    binary: false,
    hunks: [
      {
        header: `@@ -1,2 +1,3 @@ ${file}`,
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 3,
        lines: [{ kind: 'add' as const, text: `changed ${file}`, oldLine: null, newLine: 2 }]
      }
    ]
  }
})

function Harness(props: { onSession: (session: RepoSession) => void }) {
  return (
    <GitStoreProvider tabId="commit-details-tab" tabActive={true}>
      <Probe onSession={props.onSession} />
    </GitStoreProvider>
  )
}

function Probe(props: { onSession: (session: RepoSession) => void }) {
  props.onSession(useRepoSession())
  const visibleBranchRefs = new Set([refFilterKey('local', 'main')])
  return (
    <HistoryPanel
      log={log}
      loading={false}
      repoPath={repoPath}
      visibleBranchRefs={visibleBranchRefs}
      remoteBranches={[]}
      filteredCommits={log.all}
      onCommitAction={onCommitAction}
    />
  )
}

let onCommitAction = vi.fn()

async function renderHistory() {
  let session: RepoSession | undefined
  renderWithQuery(() => (
    <Harness
      onSession={(value) => {
        session = value
      }}
    />
  ))
  if (!session) {
    throw new Error('git store not initialized')
  }
  const repoSession = session
  await act(async () => {
    await repoSession.openRepo(repoPath)
  })
}

// Scoped to the graph: the panel header shows the selected commit's subject too.
const rowFor = (message: string) => {
  const rows = screen
    .getAllByTestId('commit-row')
    .filter((row) => row.textContent?.includes(message))
  if (rows.length !== 1) {
    throw new Error(`expected one commit row for ${message}, found ${rows.length}`)
  }
  return rows[0]
}

const panel = () => screen.getByTestId('commit-details-panel')

beforeEach(() => {
  onCommitAction = vi.fn()
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
    _tag: 'Ok',
    result: { path: repoPath, remotes: {}, defaultBranch: 'main' }
  })
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  setupLogStream()
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
      files: []
    }
  })
  sidecarMock.getCommitDetail.mockImplementation(async (_repo: string, sha: string) => ({
    _tag: 'Ok' as const,
    detail:
      sha === 'bbbbbbb2'
        ? detailFor(sha, {
            subject: 'middle change',
            body: '',
            files: [
              { path: 'src/gamma.ts', status: 'D', additions: 0, deletions: 7, binary: false }
            ]
          })
        : detailFor(sha)
  }))
  sidecarMock.getDiff.mockImplementation(async (_repo: string, file: string) => diffFor(file))
})

describe('commit details panel visibility', () => {
  it('stays closed until asked for, so the graph keeps the full height', async () => {
    await renderHistory()

    expect(screen.queryByTestId('commit-details-panel')).not.toBeInTheDocument()
  })

  it('opens on double-clicking a commit and shows that commit', async () => {
    await renderHistory()

    fireEvent.doubleClick(rowFor('newest change'))

    expect(await within(panel()).findByText('Why this change was needed.')).toBeInTheDocument()
    expect(sidecarMock.getCommitDetail).toHaveBeenCalledWith(repoPath, 'aaaaaaa1')
  })

  it('offers no timeline header control, so the graph header stays uncluttered', async () => {
    await renderHistory()

    expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument()
  })

  it('shows an empty state when the last selected commit is toggled back off', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))
    await waitFor(() => expect(panel()).toBeInTheDocument())

    fireEvent.click(rowFor('newest change'), { metaKey: true })

    expect(within(panel()).getByText('No commit selected')).toBeInTheDocument()
  })

  it('selects on a single click without popping the panel open', async () => {
    await renderHistory()

    fireEvent.click(rowFor('middle change'))

    expect(rowFor('middle change')).toHaveAttribute('data-selected', 'true')
    expect(screen.queryByTestId('commit-details-panel')).not.toBeInTheDocument()
  })

  it('keeps the selection when closed from the panel button', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))
    await waitFor(() => expect(panel()).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Close commit details' }))

    expect(screen.queryByTestId('commit-details-panel')).not.toBeInTheDocument()
    expect(rowFor('newest change')).toHaveAttribute('data-selected', 'true')
  })
})

describe('commit details panel contents', () => {
  it('auto-selects the first changed file and renders its diff read-only', async () => {
    await renderHistory()

    fireEvent.doubleClick(rowFor('newest change'))

    await waitFor(() =>
      expect(within(panel()).getByText('@@ -1,2 +1,3 @@ src/deep/alpha.ts')).toBeInTheDocument()
    )
    expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'src/deep/alpha.ts', false, {
      range: undefined,
      commit: 'aaaaaaa1',
      renameSource: undefined
    })
    expect(screen.queryByRole('checkbox', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Stage src/deep/alpha.ts' })
    ).not.toBeInTheDocument()
  })

  it('groups the changed files into a tree, collapsing single-child directory chains', async () => {
    await renderHistory()

    fireEvent.doubleClick(rowFor('newest change'))

    const fileList = await within(panel()).findByTestId('commit-file-scroll')
    const directories = within(fileList).getAllByTestId('commit-directory-row')
    expect(directories).toHaveLength(1)
    expect(directories[0]).toHaveTextContent('src/deep')
    expect(directories[0]).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(fileList)
        .getAllByTestId('commit-file-row')
        .map((row) => row.textContent)
    ).toEqual([
      expect.stringContaining('alpha.ts'),
      expect.stringContaining('beta.ts'),
      expect.stringContaining('README.md')
    ])
  })

  it('collapses a directory to hide its files and expands it again', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))
    await screen.findByText('@@ -1,2 +1,3 @@ src/deep/alpha.ts')
    const fileList = within(panel()).getByTestId('commit-file-scroll')

    fireEvent.click(within(fileList).getByTestId('commit-directory-row'))

    expect(within(fileList).queryByTitle('alpha.ts')).not.toBeInTheDocument()
    expect(within(fileList).getByTitle('README.md')).toBeInTheDocument()
    // The diff stays put: collapsing a directory hides rows, it does not change the selection.
    expect(within(panel()).getByText('@@ -1,2 +1,3 @@ src/deep/alpha.ts')).toBeInTheDocument()

    fireEvent.click(within(fileList).getByTestId('commit-directory-row'))

    expect(within(fileList).getByTitle('alpha.ts')).toBeInTheDocument()
  })

  it('shows the clicked file’s diff for that commit', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))
    await screen.findByText('@@ -1,2 +1,3 @@ src/deep/alpha.ts')

    fireEvent.click(within(panel()).getByText('beta.ts'))

    await waitFor(() =>
      expect(within(panel()).getByText('@@ -1,2 +1,3 @@ src/deep/beta.ts')).toBeInTheDocument()
    )
  })

  it('reports the author, dates, parents and per-file stats', async () => {
    await renderHistory()

    fireEvent.doubleClick(rowFor('newest change'))

    const meta = await within(panel()).findByTestId('commit-meta')
    expect(meta).toHaveTextContent('Ada Author')
    expect(meta).toHaveTextContent('<ada@example.com>')
    expect(meta).toHaveTextContent('3 files')
    expect(meta).toHaveTextContent('+9')
    expect(meta).toHaveTextContent('−1')
    expect(meta).toHaveTextContent('bbbbbbb')
    const fileList = within(panel()).getByTestId('commit-file-scroll')
    expect(within(fileList).getByTitle('alpha.ts')).toBeInTheDocument()
    expect(within(fileList).getByText('+3')).toBeInTheDocument()
    expect(within(fileList).getAllByText('−1')).not.toHaveLength(0)
  })

  it('says a merge commit is shown against its first parent', async () => {
    sidecarMock.getCommitDetail.mockResolvedValue({
      _tag: 'Ok',
      detail: detailFor('aaaaaaa1', { parents: ['bbbbbbb2', 'ddddddd4'] })
    })
    await renderHistory()

    fireEvent.doubleClick(rowFor('newest change'))

    const meta = await within(panel()).findByTestId('commit-meta')
    expect(meta).toHaveTextContent('Parents')
    expect(meta).toHaveTextContent('changes shown against the first parent')
  })

  it('labels a root commit as such rather than showing an empty parent list', async () => {
    sidecarMock.getCommitDetail.mockResolvedValue({
      _tag: 'Ok',
      detail: detailFor('ccccccc3', { parents: [] })
    })
    await renderHistory()

    fireEvent.doubleClick(rowFor('oldest change'))

    expect(await within(panel()).findByText(/Root commit/)).toBeInTheDocument()
  })

  it('offers the full SHA for copying through the existing commit action', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))

    fireEvent.click(await screen.findByRole('button', { name: 'Copy full SHA aaaaaaa1' }))

    expect(onCommitAction).toHaveBeenCalledWith('copy-sha', 'aaaaaaa1', 'newest change')
  })

  it('follows the selection to another commit while open', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))
    await screen.findByText('@@ -1,2 +1,3 @@ src/deep/alpha.ts')

    fireEvent.click(rowFor('middle change'))

    await waitFor(() => expect(within(panel()).getByText('gamma.ts')).toBeInTheDocument())
    expect(sidecarMock.getCommitDetail).toHaveBeenCalledWith(repoPath, 'bbbbbbb2')
  })
})

describe('commit multi-selection', () => {
  it('summarises several selected commits instead of guessing a merged diff', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))
    await screen.findByText('@@ -1,2 +1,3 @@ src/deep/alpha.ts')

    fireEvent.click(rowFor('oldest change'), { metaKey: true })

    await waitFor(() => expect(within(panel()).getByText('2 commits selected')).toBeInTheDocument())
    const summary = within(panel()).getByTestId('commit-selection-summary')
    expect(summary).toHaveTextContent('aaaaaaa')
    expect(summary).toHaveTextContent('newest change')
    expect(summary).toHaveTextContent('ccccccc')
    expect(summary).toHaveTextContent('oldest change')
    expect(within(panel()).queryByText('@@ -1,2 +1,3 @@ src/deep/alpha.ts')).not.toBeInTheDocument()
  })

  it('selects a contiguous range on shift-click', async () => {
    await renderHistory()

    fireEvent.click(rowFor('newest change'))
    fireEvent.click(rowFor('oldest change'), { shiftKey: true })

    for (const message of ['newest change', 'middle change', 'oldest change']) {
      expect(rowFor(message)).toHaveAttribute('data-selected', 'true')
    }
  })

  it('dismisses the panel on the first Escape and the selection on the second', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))
    fireEvent.click(rowFor('oldest change'), { metaKey: true })
    await waitFor(() => expect(panel()).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('commit-details-panel')).not.toBeInTheDocument()
    expect(rowFor('newest change')).toHaveAttribute('data-selected', 'true')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(rowFor('newest change')).not.toHaveAttribute('data-selected')
  })
})

describe('commit context menu', () => {
  it('lets Escape close an open menu without also closing the details panel', async () => {
    await renderHistory()
    fireEvent.doubleClick(rowFor('newest change'))
    await waitFor(() => expect(panel()).toBeInTheDocument())

    fireEvent.contextMenu(rowFor('newest change'))
    await screen.findByRole('menuitem', { name: 'Revert commit' })
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menuitem', { name: 'Revert commit' })).not.toBeInTheDocument()
    expect(panel()).toBeInTheDocument()
  })

  it('acts on the right-clicked commit regardless of the current selection', async () => {
    await renderHistory()
    fireEvent.click(rowFor('newest change'))

    fireEvent.contextMenu(rowFor('oldest change'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Revert commit' }))

    expect(onCommitAction).toHaveBeenCalledWith('revert', 'ccccccc3', 'oldest change')
    expect(rowFor('newest change')).toHaveAttribute('data-selected', 'true')
    expect(rowFor('oldest change')).not.toHaveAttribute('data-selected')
  })
})
