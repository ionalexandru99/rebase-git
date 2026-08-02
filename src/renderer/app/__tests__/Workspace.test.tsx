import { RebaseOnto, RevertCommit, StageAll } from '@shared/rpc'
import type { CommitDetail } from '@shared/schemas/git'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openedRepoResponse, statusResponse } from '../../../test/builders'
import { renderApp } from '../../../test/render-app'
import { mockBranchResponses, setupLogStream, sidecarMock } from '../../../test/setup'

const repoPath = '/home/user/projects/my-app'

const commits = [
  {
    hash: 'aaaaaaa1',
    message: 'newest change',
    author_name: 'Ada Author',
    date: '2026-07-21T09:42:00.000Z',
    parents: ['bbbbbbb2'],
    refs: 'HEAD -> main'
  },
  {
    hash: 'bbbbbbb2',
    message: 'middle change',
    author_name: 'Ada Author',
    date: '2026-07-20T09:42:00.000Z',
    parents: ['ccccccc3'],
    refs: ''
  },
  {
    hash: 'ccccccc3',
    message: 'oldest change',
    author_name: 'Ada Author',
    date: '2026-07-19T09:42:00.000Z',
    parents: [],
    refs: ''
  }
]

function detailFor(sha: string): CommitDetail {
  const entry = commits.find((commit) => commit.hash === sha)
  return {
    sha,
    author: { name: 'Ada Author', email: 'ada@example.com' },
    authorDate: '2026-07-21T09:42:00.000Z',
    subject: entry?.message ?? 'unknown',
    body: '',
    files: []
  }
}

function mockBaseAPI() {
  vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(true)
  vi.mocked(window.electronAPI.getWorkspaces).mockResolvedValue(['/home/user/projects'])
  vi.mocked(window.electronAPI.getActiveWorkspace).mockResolvedValue('/home/user/projects')
  vi.mocked(window.electronAPI.setActiveWorkspace).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getRecentRepos).mockResolvedValue([])
  vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({ _tag: 'Ok', repos: [repoPath] })
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openedRepoResponse(repoPath))
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  sidecarMock.getStatus.mockResolvedValue(
    statusResponse({
      modified: ['src/a.ts'],
      staged: ['src/b.ts'],
      files: [
        { path: 'src/a.ts', index: ' ', working_dir: 'M' },
        { path: 'src/b.ts', index: 'M', working_dir: ' ' }
      ]
    })
  )
  sidecarMock.getCommitDetail.mockImplementation(async (_repo: string, sha: string) => ({
    _tag: 'Ok' as const,
    detail: detailFor(sha)
  }))
}

async function openRepo(tracking?: Record<string, { ahead: number; behind: number }>) {
  mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [], tracking })
  const stream = setupLogStream()

  renderApp()
  fireEvent.click(await screen.findByText(repoPath))
  await screen.findByRole('region', { name: 'Commits' })
  await waitFor(() => expect(window.electronAPI.startLogStream).toHaveBeenCalled())

  stream.fire({ repoPath, commits })
  stream.fireDone(repoPath, false)
  await screen.findByText('newest change')
}

const detailPane = () => screen.getByRole('region', { name: 'Details' })

const rowFor = (message: string) => {
  const rows = screen
    .getAllByTestId('commit-row')
    .filter((row) => row.textContent?.includes(message))
  if (rows.length !== 1) {
    throw new Error(`expected one commit row for ${message}, found ${rows.length}`)
  }
  return rows[0]
}

beforeEach(() => {
  mockBaseAPI()
})

describe('Workspace selection drives the detail pane', () => {
  it('shows HEAD in the detail pane before anything has been selected', async () => {
    await openRepo()

    await waitFor(() =>
      expect(within(detailPane()).getByTestId('commit-detail-sha')).toHaveTextContent('aaaaaaa')
    )
    expect(within(detailPane()).getByRole('heading', { level: 1 })).toHaveTextContent(
      'newest change'
    )
  })

  it('shows the checked-out HEAD when the timeline defaults to another branch', async () => {
    const featureCommits = [
      {
        hash: 'feature1',
        message: 'feature tip',
        author_name: 'Ada Author',
        date: '2026-07-22T09:42:00.000Z',
        parents: ['base0001'],
        refs: 'HEAD -> feature'
      },
      {
        hash: 'main0001',
        message: 'main tip',
        author_name: 'Ada Author',
        date: '2026-07-21T09:42:00.000Z',
        parents: ['base0001'],
        refs: 'main'
      },
      {
        hash: 'base0001',
        message: 'shared base',
        author_name: 'Ada Author',
        date: '2026-07-20T09:42:00.000Z',
        parents: [],
        refs: ''
      }
    ]
    mockBranchResponses({ current: 'feature', all: ['main', 'feature'], remotes: [], tags: [] })
    sidecarMock.getCommitDetail.mockImplementation(async (_repo: string, sha: string) => ({
      _tag: 'Ok' as const,
      detail: {
        sha,
        author: { name: 'Ada Author', email: 'ada@example.com' },
        authorDate: '2026-07-22T09:42:00.000Z',
        subject: featureCommits.find((commit) => commit.hash === sha)?.message ?? 'unknown',
        body: '',
        files: []
      }
    }))
    const stream = setupLogStream()

    renderApp()
    fireEvent.click(await screen.findByText(repoPath))
    await screen.findByRole('region', { name: 'Commits' })
    await waitFor(() => expect(window.electronAPI.startLogStream).toHaveBeenCalled())
    stream.fire({ repoPath, commits: featureCommits })
    stream.fireDone(repoPath, false)

    await waitFor(() =>
      expect(within(detailPane()).getByTestId('commit-detail-sha')).toHaveTextContent('feature')
    )
    expect(within(detailPane()).getByRole('heading', { level: 1 })).toHaveTextContent('feature tip')
    expect(screen.queryByText('No commit selected')).not.toBeInTheDocument()
  })

  it('follows a single click on a commit row', async () => {
    await openRepo()

    fireEvent.click(rowFor('middle change'))

    await waitFor(() =>
      expect(within(detailPane()).getByRole('heading', { level: 1 })).toHaveTextContent(
        'middle change'
      )
    )
    expect(rowFor('middle change')).toHaveAttribute('data-selected', 'true')
  })

  it('shows the staging surface when the working-copy row is picked', async () => {
    await openRepo()

    fireEvent.click(screen.getByTestId('working-copy-row'))

    expect(
      await within(detailPane()).findByRole('textbox', { name: 'Commit message' })
    ).toBeInTheDocument()
  })

  it('heads the staging surface with the working copy and its counts', async () => {
    await openRepo()

    fireEvent.click(screen.getByTestId('working-copy-row'))

    const header = await within(detailPane()).findByTestId('working-copy-header')
    expect(header).toHaveTextContent('Working copy')
    expect(header).toHaveTextContent('2 files · 1 staged')
    expect(within(detailPane()).queryByText('Changes')).not.toBeInTheDocument()
  })

  it('stages every unstaged file from the working-copy header', async () => {
    let stageAllBody: Record<string, unknown> | undefined
    sidecarMock.respond(StageAll, (body) => {
      stageAllBody = body
      return { _tag: 'Ok' }
    })
    await openRepo()
    fireEvent.click(screen.getByTestId('working-copy-row'))
    const header = await within(detailPane()).findByTestId('working-copy-header')

    fireEvent.click(within(header).getByRole('button', { name: 'Stage all' }))

    await waitFor(() => expect(stageAllBody).toMatchObject({ files: ['src/a.ts'] }))
  })

  it('falls back to HEAD when Escape clears the selection', async () => {
    await openRepo()
    fireEvent.click(rowFor('oldest change'))
    await waitFor(() =>
      expect(within(detailPane()).getByRole('heading', { level: 1 })).toHaveTextContent(
        'oldest change'
      )
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() =>
      expect(within(detailPane()).getByRole('heading', { level: 1 })).toHaveTextContent(
        'newest change'
      )
    )
    expect(rowFor('oldest change')).not.toHaveAttribute('data-selected')
  })

  it('summarises a multi-selection instead of guessing a merged diff', async () => {
    await openRepo()

    fireEvent.click(rowFor('newest change'))
    fireEvent.click(rowFor('oldest change'), { metaKey: true })

    await waitFor(() =>
      expect(within(detailPane()).getByText('2 commits selected')).toBeInTheDocument()
    )
    const summary = within(detailPane()).getByTestId('commit-selection-summary')
    expect(summary).toHaveTextContent('newest change')
    expect(summary).toHaveTextContent('oldest change')
  })

  it('selects a contiguous range on shift-click', async () => {
    await openRepo()

    fireEvent.click(rowFor('newest change'))
    fireEvent.click(rowFor('oldest change'), { shiftKey: true })

    for (const message of ['newest change', 'middle change', 'oldest change']) {
      expect(rowFor(message)).toHaveAttribute('data-selected', 'true')
    }
  })

  it('acts on the right-clicked commit regardless of the current selection', async () => {
    let revertBody: Record<string, unknown> | undefined
    sidecarMock.respond(RevertCommit, (body) => {
      revertBody = body
      return { _tag: 'Ok' }
    })
    await openRepo()
    fireEvent.click(rowFor('newest change'))

    fireEvent.contextMenu(rowFor('oldest change'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Revert commit' }))

    await waitFor(() => expect(revertBody).toMatchObject({ sha: 'ccccccc3' }))
    expect(rowFor('newest change')).toHaveAttribute('data-selected', 'true')
  })

  it('rebases the current branch onto the ref picked in the branch menu', async () => {
    let rebaseBody: Record<string, unknown> | undefined
    sidecarMock.respond(RebaseOnto, (body) => {
      rebaseBody = body
      return { _tag: 'Ok' }
    })
    mockBranchResponses({ current: 'main', all: ['main', 'feature'], remotes: [], tags: [] })
    const stream = setupLogStream()
    renderApp()
    fireEvent.click(await screen.findByText(repoPath))
    await screen.findByRole('region', { name: 'Commits' })
    stream.fire({ repoPath, commits })
    stream.fireDone(repoPath, false)

    fireEvent.contextMenu(await screen.findByTitle('feature'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rebase main onto feature' }))

    await waitFor(() =>
      expect(rebaseBody).toMatchObject({ repoPath, refKind: 'local', fullPath: 'feature' })
    )
    expect(await screen.findByText('Rebased main onto feature')).toBeInTheDocument()
  })
})

describe('Workspace shell composition', () => {
  it('lays out refs, commits, details and a status dock with no view switcher', async () => {
    await openRepo()

    expect(screen.getByRole('complementary', { name: 'Branches' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Commits' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resize commit list' })).toBeInTheDocument()
    expect(detailPane()).toBeInTheDocument()
    expect(screen.getByTestId('status-dock')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Local changes' })).not.toBeInTheDocument()
    expect(screen.queryByText('Visible:')).not.toBeInTheDocument()
  })

  it('heads the commit list with the repo name, its commit count and the remote actions', async () => {
    await openRepo({ main: { ahead: 2, behind: 1 } })

    expect(screen.getByText('my-app')).toBeInTheDocument()
    expect(screen.getByText(/3 commits/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fetch' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('sync-button')).toHaveTextContent('↓1'))
    expect(screen.getByTestId('sync-button')).toHaveTextContent('↑2')
  })

  it('reports the branch and the working copy in the status dock', async () => {
    await openRepo({ main: { ahead: 1, behind: 0 } })

    const dock = screen.getByTestId('status-dock')
    expect(dock).toHaveTextContent('main')
    expect(dock).toHaveTextContent('2 changed')
    expect(dock).toHaveTextContent('1 staged')
    await waitFor(() => expect(dock).toHaveTextContent('↑1'))
  })
})

describe('Workspace sync', () => {
  it('fetches when the branch is level with its upstream', async () => {
    await openRepo({ main: { ahead: 0, behind: 0 } })

    fireEvent.click(screen.getByTestId('sync-button'))

    await waitFor(() => expect(sidecarMock.fetchRepo).toHaveBeenCalledWith(repoPath))
    expect(sidecarMock.pullRepo).not.toHaveBeenCalled()
    expect(sidecarMock.pushRepo).not.toHaveBeenCalled()
  })

  it('pulls when the branch is only behind', async () => {
    await openRepo({ main: { ahead: 0, behind: 3 } })
    await waitFor(() => expect(screen.getByTestId('sync-button')).toHaveTextContent('↓3'))

    fireEvent.click(screen.getByTestId('sync-button'))

    await waitFor(() => expect(sidecarMock.pullRepo).toHaveBeenCalledWith(repoPath))
    expect(sidecarMock.pushRepo).not.toHaveBeenCalled()
  })

  it('pushes when the branch is only ahead', async () => {
    await openRepo({ main: { ahead: 2, behind: 0 } })
    await waitFor(() => expect(screen.getByTestId('sync-button')).toHaveTextContent('↑2'))

    fireEvent.click(screen.getByTestId('sync-button'))

    await waitFor(() => expect(sidecarMock.pushRepo).toHaveBeenCalledWith(repoPath))
    expect(sidecarMock.pullRepo).not.toHaveBeenCalled()
  })

  it('keeps the diverged pull dialog reachable from a sync', async () => {
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'PullDiverged' })
    await openRepo({ main: { ahead: 2, behind: 3 } })
    await waitFor(() => expect(screen.getByTestId('sync-button')).toHaveTextContent('↓3'))

    fireEvent.click(screen.getByTestId('sync-button'))

    expect(
      await screen.findByText('Your branch and its upstream have diverged')
    ).toBeInTheDocument()
    expect(sidecarMock.pushRepo).not.toHaveBeenCalled()
  })
})
