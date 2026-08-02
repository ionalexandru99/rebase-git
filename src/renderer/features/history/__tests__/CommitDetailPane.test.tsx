import type { CommitDetail } from '@shared/schemas/git'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { type CSSProperties, type ReactNode, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitDetailPane } from '@/features/history/CommitDetailPane'
import { GitStoreProvider, type RepoSession, useRepoSession } from '@/stores/git'
import { openedRepoResponse, statusResponse } from '../../../../test/builders'
import { renderWithQuery } from '../../../../test/render-app'
import { setupLogStream, sidecarMock } from '../../../../test/setup'
import { createHistoryEntryBuilder } from './fixtures'

vi.mock('@/features/diff/diff-theme', () => ({
  diffThemeStyle: () => ({}),
  DIFF_UNSAFE_CSS: 'mock-unsafe-css'
}))

vi.mock('@pierre/diffs/react', () => ({
  Virtualizer: (props: { children?: ReactNode; className?: string; style?: CSSProperties }) => (
    <div data-testid="pierre-virtualizer" className={props.className} style={props.style}>
      {props.children}
    </div>
  ),
  FileDiff: (props: { fileDiff: { name: string }; options?: Record<string, unknown> }) => (
    <div
      data-testid="pierre-file-diff"
      data-file={props.fileDiff.name}
      data-options={JSON.stringify(props.options)}
    />
  )
}))

const repoPath = '/home/user/project'

const entry = createHistoryEntryBuilder({
  message: 'msg',
  author_name: 'Ada Author',
  date: '2026-07-21T09:42:00.000Z'
})

const commits = [
  entry({
    hash: 'aaaaaaa1',
    message: 'newest change',
    refs: 'HEAD -> main',
    parents: ['bbbbbbb2']
  }),
  entry({ hash: 'bbbbbbb2', message: 'middle change', parents: ['ccccccc3'] }),
  entry({ hash: 'ccccccc3', message: 'oldest change', parents: [] })
]
const commitsByHash = new Map(commits.map((commit) => [commit.hash, commit]))

function detailFor(sha: string, overrides: Partial<CommitDetail> = {}): CommitDetail {
  return {
    sha,
    author: { name: 'Ada Author', email: 'ada@example.com' },
    authorDate: '2026-07-21T09:42:00.000Z',
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

const patchFor = (file: string) => `diff --git a/${file} b/${file}
index a92d664..80a6513 100644
--- a/${file}
+++ b/${file}
@@ -1,3 +1,3 @@
 line 1
-line 2
+changed ${file}
 line 3
`

const diffFor = (file: string) => ({
  _tag: 'Ok' as const,
  patch: patchFor(file),
  binary: false
})

const diffShownFor = async (file: string) => {
  await waitFor(() => {
    const nodes = screen.getAllByTestId('pierre-file-diff')
    expect(nodes.some((node) => node.getAttribute('data-file') === file)).toBe(true)
  })
}

let onCommitAction = vi.fn()

function Probe(props: { shas: readonly string[]; onSession: (session: RepoSession) => void }) {
  const session = useRepoSession()
  const onSession = props.onSession
  useEffect(() => {
    onSession(session)
  }, [session, onSession])
  return (
    <CommitDetailPane
      shas={props.shas}
      commitsByHash={commitsByHash}
      remotes={{}}
      remoteNames={new Set()}
      onCommitAction={onCommitAction}
    />
  )
}

async function renderPane(shas: readonly string[], detailOverrides?: Partial<CommitDetail>) {
  if (detailOverrides) {
    sidecarMock.getCommitDetail.mockImplementation(async (_repo: string, sha: string) => ({
      _tag: 'Ok' as const,
      detail: detailFor(sha, detailOverrides)
    }))
  }
  let session: RepoSession | undefined
  renderWithQuery(() => (
    <GitStoreProvider tabId="commit-detail-tab" tabActive={true}>
      <Probe
        shas={shas}
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
}

const pane = () => screen.getByTestId('commit-detail-pane')

beforeEach(() => {
  onCommitAction = vi.fn()
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openedRepoResponse(repoPath))
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  setupLogStream()
  sidecarMock.getStatus.mockResolvedValue(statusResponse())
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

describe('CommitDetailPane header', () => {
  it('carries the short sha and the direct commit actions', async () => {
    await renderPane(['aaaaaaa1'])

    expect(
      await within(pane()).findByRole('button', { name: 'Copy full SHA aaaaaaa1' })
    ).toBeInTheDocument()
    expect(within(pane()).getByRole('button', { name: 'Revert' })).toBeInTheDocument()
    expect(within(pane()).getByRole('button', { name: 'Cherry-pick' })).toBeInTheDocument()
  })

  it('reverts and cherry-picks through the shared commit action handler', async () => {
    await renderPane(['aaaaaaa1'])
    await within(pane()).findByTestId('commit-meta')

    fireEvent.click(within(pane()).getByRole('button', { name: 'Revert' }))
    expect(onCommitAction).toHaveBeenCalledWith('revert', 'aaaaaaa1', 'newest change')

    fireEvent.click(within(pane()).getByRole('button', { name: 'Cherry-pick' }))
    expect(onCommitAction).toHaveBeenCalledWith('cherry-pick', 'aaaaaaa1', 'newest change')
  })

  it('offers the remaining commit actions from the overflow menu', async () => {
    await renderPane(['aaaaaaa1'])
    await within(pane()).findByTestId('commit-meta')

    fireEvent.click(within(pane()).getByRole('button', { name: 'Commit actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy message' }))

    expect(onCommitAction).toHaveBeenCalledWith('copy-message', 'aaaaaaa1', 'newest change')
  })

  it('offers the full SHA for copying through the existing commit action', async () => {
    await renderPane(['aaaaaaa1'])

    fireEvent.click(await screen.findByRole('button', { name: 'Copy full SHA aaaaaaa1' }))

    expect(onCommitAction).toHaveBeenCalledWith('copy-sha', 'aaaaaaa1', 'newest change')
  })

  it('summarises the commit totals next to its sha', async () => {
    await renderPane(['aaaaaaa1'])

    const stats = await within(pane()).findByTestId('commit-stats')
    expect(stats).toHaveTextContent('3 files')
    expect(stats).toHaveTextContent('+9')
    expect(stats).toHaveTextContent('−1')
  })

  it('drops the commit totals when nothing in the commit changed a line', async () => {
    sidecarMock.getCommitDetail.mockResolvedValue({
      _tag: 'Ok',
      detail: detailFor('aaaaaaa1', {
        files: [{ path: 'logo.png', status: 'M', additions: 0, deletions: 0, binary: true }]
      })
    })
    await renderPane(['aaaaaaa1'])

    const stats = await within(pane()).findByTestId('commit-stats')
    expect(stats).toHaveTextContent('1 file')
    expect(stats.textContent).not.toContain('+0')
    expect(stats.textContent).not.toContain('−0')
  })
})

describe('CommitDetailPane commit head', () => {
  it('leads with the subject, the author, an absolute date and the parent', async () => {
    await renderPane(['aaaaaaa1'])

    const meta = await within(pane()).findByTestId('commit-meta')
    expect(within(meta).getByRole('heading', { level: 1 })).toHaveTextContent('newest change')
    expect(within(meta).getByText('Ada Author')).toBeInTheDocument()
    expect(within(meta).getByText('ada@example.com')).toBeInTheDocument()
    expect(within(meta).getByText(/2026/)).toBeInTheDocument()
    expect(within(meta).getByTestId('commit-detail-sha')).toHaveTextContent('aaaaaaa')
    expect(within(meta).getByTestId('commit-detail-parents')).toHaveTextContent('bbbbbbb')
  })

  it('keeps the full commit body on screen', async () => {
    await renderPane(['aaaaaaa1'])

    expect(await within(pane()).findByTestId('commit-body')).toHaveTextContent(
      'Why this change was needed.'
    )
  })

  it('lets the commit body use the whole pane width', async () => {
    await renderPane(['aaaaaaa1'])

    const body = await within(pane()).findByTestId('commit-body')
    expect(body.className).not.toMatch(/max-w-/)
  })

  it('reflows a hard-wrapped commit body so lines run to the pane edge', async () => {
    await renderPane(['aaaaaaa1'], {
      body: 'A first line the author wrapped at the conventional seventy-two columns\nso the sentence continues here.'
    })

    const body = await within(pane()).findByTestId('commit-body')
    expect(body.textContent).toBe(
      'A first line the author wrapped at the conventional seventy-two columns so the sentence continues here.'
    )
  })

  it('shows the refs decorating the commit', async () => {
    await renderPane(['aaaaaaa1'])

    const meta = await within(pane()).findByTestId('commit-meta')
    expect(within(meta).getByTitle('main')).toBeInTheDocument()
  })
})

describe('CommitDetailPane changed-files column', () => {
  beforeEach(() => {
    localStorage.removeItem('rebase:commit-files-width')
  })

  it('applies a persisted column width', async () => {
    localStorage.setItem('rebase:commit-files-width', '300')
    await renderPane(['aaaaaaa1'])

    const split = await within(pane()).findByTestId('commit-detail-split')
    await waitFor(() => expect(split.style.gridTemplateColumns).toContain('min(300px, 40%)'))
  })

  it('resizes by dragging its divider and remembers the width', async () => {
    await renderPane(['aaaaaaa1'])
    const handle = await within(pane()).findByRole('button', { name: 'Resize changed files list' })
    await waitFor(() =>
      expect(within(pane()).getByTestId('commit-detail-split').style.gridTemplateColumns).toContain(
        'min(232px, 40%)'
      )
    )

    fireEvent.mouseDown(handle, { clientX: 0 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })

    const split = within(pane()).getByTestId('commit-detail-split')
    await waitFor(() => expect(split.style.gridTemplateColumns).toContain('min(292px, 40%)'))
    expect(localStorage.getItem('rebase:commit-files-width')).toBe('292')
  })

  it('returns to the default width on a double-click of its divider', async () => {
    localStorage.setItem('rebase:commit-files-width', '320')
    await renderPane(['aaaaaaa1'])
    const split = await within(pane()).findByTestId('commit-detail-split')
    await waitFor(() => expect(split.style.gridTemplateColumns).toContain('min(320px, 40%)'))

    fireEvent.doubleClick(within(pane()).getByRole('button', { name: 'Resize changed files list' }))

    await waitFor(() => expect(split.style.gridTemplateColumns).toContain('min(232px, 40%)'))
  })
})

describe('CommitDetailPane contents', () => {
  it('caps the changed-files column to a share of the pane so a narrow pane still shows the diff', async () => {
    await renderPane(['aaaaaaa1'])

    const split = await within(pane()).findByTestId('commit-detail-split')
    expect(split.getAttribute('style')).toContain('min(232px, 40%)')
  })

  it('auto-selects the first changed file and renders its diff read-only', async () => {
    await renderPane(['aaaaaaa1'])

    await diffShownFor('src/deep/alpha.ts')
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
    await renderPane(['aaaaaaa1'])

    const fileList = await within(pane()).findByTestId('commit-file-scroll')
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
    await renderPane(['aaaaaaa1'])
    await diffShownFor('src/deep/alpha.ts')
    const fileList = within(pane()).getByTestId('commit-file-scroll')

    fireEvent.click(within(fileList).getByTestId('commit-directory-row'))

    expect(within(fileList).queryByTitle('alpha.ts')).not.toBeInTheDocument()
    expect(within(fileList).getByTitle('README.md')).toBeInTheDocument()
    expect(screen.getByTestId('pierre-file-diff')).toHaveAttribute('data-file', 'src/deep/alpha.ts')

    fireEvent.click(within(fileList).getByTestId('commit-directory-row'))

    expect(within(fileList).getByTitle('alpha.ts')).toBeInTheDocument()
  })

  it('leaves the line counts off files that changed without changing a line', async () => {
    sidecarMock.getCommitDetail.mockResolvedValue({
      _tag: 'Ok',
      detail: detailFor('aaaaaaa1', {
        files: [
          { path: 'logo.png', status: 'M', additions: 0, deletions: 0, binary: true },
          {
            path: 'renamed.ts',
            status: 'R',
            additions: 0,
            deletions: 0,
            binary: false,
            oldPath: 'moved.ts'
          },
          { path: 'edited.ts', status: 'M', additions: 4, deletions: 2, binary: false }
        ]
      })
    })
    await renderPane(['aaaaaaa1'])

    const fileList = await within(pane()).findByTestId('commit-file-scroll')
    const rowText = (name: string) =>
      within(fileList)
        .getAllByTestId('commit-file-row')
        .find((row) => row.textContent?.includes(name))?.textContent ?? ''
    expect(rowText('logo.png')).toContain('binary')
    expect(rowText('logo.png')).not.toContain('+0')
    expect(rowText('moved.ts → renamed.ts')).not.toContain('+0')
    expect(rowText('moved.ts → renamed.ts')).not.toContain('−0')
    expect(rowText('edited.ts')).toContain('+4')
    expect(rowText('edited.ts')).toContain('−2')
  })

  it('shows the clicked file’s diff for that commit', async () => {
    await renderPane(['aaaaaaa1'])
    await diffShownFor('src/deep/alpha.ts')

    fireEvent.click(within(pane()).getByText('beta.ts'))

    await diffShownFor('src/deep/beta.ts')
  })
})

describe('CommitDetailPane multi-selection', () => {
  it('summarises several selected commits instead of guessing a merged diff', async () => {
    await renderPane(['aaaaaaa1', 'ccccccc3'])

    await waitFor(() => expect(within(pane()).getByText('2 commits selected')).toBeInTheDocument())
    const summary = within(pane()).getByTestId('commit-selection-summary')
    expect(summary).toHaveTextContent('aaaaaaa')
    expect(summary).toHaveTextContent('newest change')
    expect(summary).toHaveTextContent('ccccccc')
    expect(summary).toHaveTextContent('oldest change')
    expect(within(pane()).queryByTestId('pierre-file-diff')).not.toBeInTheDocument()
  })
})
