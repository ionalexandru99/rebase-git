import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiffPanel } from '@/features/diff/DiffPanel'
import type { SelectedFile } from '@/features/status/StatusPanel'
import { GitStoreProvider, type RepoSession, useRepoSession } from '@/stores/git'
import { renderWithQuery } from '../../../../test/render-app'
import { setupLogStream, sidecarMock } from '../../../../test/setup'

const repoPath = '/home/user/project'

const sampleDiff = {
  _tag: 'Ok' as const,
  patch: '',
  diff: {
    filePath: 'src/app.ts',
    binary: false,
    hunks: [
      {
        header: '@@ -1,3 +1,4 @@',
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 4,
        lines: [
          { kind: 'context' as const, text: 'line one', oldLine: 1, newLine: 1 },
          { kind: 'add' as const, text: 'line two added', oldLine: null, newLine: 2 },
          { kind: 'del' as const, text: 'line removed', oldLine: 2, newLine: null }
        ]
      }
    ]
  }
}

const emptyDiff = {
  _tag: 'Ok' as const,
  patch: '',
  diff: { filePath: 'src/app.ts', binary: false, hunks: [] }
}

function mockDiffOn(side: 'unstaged' | 'staged') {
  sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) =>
    staged === (side === 'staged') ? sampleDiff : emptyDiff
  )
}

const getRenderedDiffLine = (text: string) =>
  screen.getAllByText((_, element) => element?.textContent === text)[0]

const hunkAt = (header: string, oldStart: number, newStart: number) => ({
  header,
  oldStart,
  oldCount: 2,
  newStart,
  newCount: 2,
  lines: [{ kind: 'context' as const, text: `at ${header}`, oldLine: oldStart, newLine: newStart }]
})

const diffWith = (hunks: ReturnType<typeof hunkAt>[]) => ({
  _tag: 'Ok' as const,
  patch: '',
  diff: {
    filePath: 'src/app.ts',
    binary: false,
    hunks
  }
})

function mockPartiallyStagedDiff() {
  sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) => ({
    _tag: 'Ok' as const,
    patch: '',
    diff: {
      filePath: 'src/app.ts',
      binary: false,
      hunks: staged
        ? [hunkAt('@@ -1,2 +1,2 @@ staged-first', 1, 1)]
        : [hunkAt('@@ -30,2 +30,2 @@ unstaged-second', 30, 30)]
    }
  }))
}

const stagedSides = () =>
  sidecarMock.getDiff.mock.calls.map((call: unknown[]) => call[2] as boolean)

type AmendDrop = Parameters<typeof DiffPanel>[0]['amendDrop']

interface HarnessProps {
  tabActive: boolean
  selected: SelectedFile | null
  amendDrop?: AmendDrop
  onSession: (session: RepoSession) => void
}

function DiffPanelHarness(props: HarnessProps) {
  return (
    <GitStoreProvider tabId="diff-test-tab" tabActive={props.tabActive}>
      <DiffPanelProbe
        selected={props.selected}
        amendDrop={props.amendDrop}
        onSession={props.onSession}
      />
    </GitStoreProvider>
  )
}

function DiffPanelProbe(props: Pick<HarnessProps, 'selected' | 'amendDrop' | 'onSession'>) {
  const session = useRepoSession()
  props.onSession(session)
  return <DiffPanel selected={props.selected} amendDrop={props.amendDrop} />
}

async function renderDiffPanel(selected: SelectedFile | null, amendDrop?: AmendDrop) {
  let session: RepoSession | undefined
  renderWithQuery(() => (
    <DiffPanelHarness
      tabActive={true}
      selected={selected}
      amendDrop={amendDrop}
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
  return repoSession
}

beforeEach(() => {
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
    _tag: 'Ok',
    result: { path: repoPath, remotes: {}, defaultBranch: 'main' }
  })
  vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
  vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  setupLogStream()
  sidecarMock.getStatus.mockResolvedValue({
    _tag: 'Ok',
    status: {
      current: 'main',
      modified: ['src/app.ts'],
      staged: [],
      not_added: [],
      conflicted: [],
      deleted: [],
      created: [],
      renamed: [],
      files: []
    }
  })
  sidecarMock.getLocalBranches.mockResolvedValue({
    _tag: 'Ok',
    branches: { current: 'main', all: ['main'] }
  })
  sidecarMock.getRemoteRefs.mockResolvedValue({
    _tag: 'Ok',
    refs: { remotes: [], tags: [] }
  })
  mockDiffOn('unstaged')
  sidecarMock.stageHunk.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.unstageHunk.mockResolvedValue({ _tag: 'Ok' })
})

describe('DiffPanel', () => {
  it('shows an empty state when no file is selected', async () => {
    await renderDiffPanel(null)
    expect(screen.getByText('No file selected')).toBeInTheDocument()
  })

  it('loads and renders hunks with line numbers and +/- totals', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await waitFor(() => {
      expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'src/app.ts', false, {
        range: undefined,
        commit: undefined,
        renameSource: undefined
      })
      expect(screen.getByText('@@ -1,3 +1,4 @@')).toBeInTheDocument()
    })
    expect(getRenderedDiffLine('line two added')).toBeInTheDocument()
    expect(getRenderedDiffLine('line removed')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('renders no per-hunk buttons, only checkboxes', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByText('@@ -1,3 +1,4 @@')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unstage hunk' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Stage hunk' })).toBeInTheDocument()
  })

  it('reads only the worktree side for a file selected in the unstaged group', async () => {
    mockPartiallyStagedDiff()
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByText('@@ -30,2 +30,2 @@ unstaged-second')
    expect(screen.queryByText('@@ -1,2 +1,2 @@ staged-first')).not.toBeInTheDocument()
    expect(stagedSides()).toEqual([false])
    expect(screen.getAllByTestId('diff-hunk')).toHaveLength(1)
  })

  it('reads only the index side for a file selected in the staged group', async () => {
    mockPartiallyStagedDiff()
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByText('@@ -1,2 +1,2 @@ staged-first')
    expect(screen.queryByText('@@ -30,2 +30,2 @@ unstaged-second')).not.toBeInTheDocument()
    expect(stagedSides()).toEqual([true])
  })

  it('shows the worktree side of a conflicted file, where git falls back to --ours', async () => {
    sidecarMock.getStatus.mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: ['src/app.ts'],
        deleted: [],
        created: [],
        renamed: [],
        files: [{ path: 'src/app.ts', index: 'U', working_dir: 'U' }]
      }
    })
    await renderDiffPanel({ file: 'src/app.ts', group: 'conflicts' })

    await screen.findByText('@@ -1,3 +1,4 @@')
    expect(stagedSides()).toEqual([false])
  })

  it('offers no hunk staging for a conflicted file', async () => {
    sidecarMock.getStatus.mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: ['src/app.ts'],
        deleted: [],
        created: [],
        renamed: [],
        files: [{ path: 'src/app.ts', index: 'U', working_dir: 'U' }]
      }
    })
    await renderDiffPanel({ file: 'src/app.ts', group: 'conflicts' })

    await screen.findByText('@@ -1,3 +1,4 @@')
    expect(screen.queryAllByRole('checkbox')).toEqual([])
  })

  it('renders the header without a file-level staging checkbox, which the lists now own', async () => {
    mockPartiallyStagedDiff()
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByText('@@ -30,2 +30,2 @@ unstaged-second')
    expect(screen.getByText('src/app.ts')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /^(Stage|Unstage) src\/app\.ts$/ })).toBeNull()
  })

  it('stages a hunk from the unstaged side', async () => {
    mockPartiallyStagedDiff()
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Stage hunk' }))
    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -30,2 +30,2 @@ unstaged-second'
      )
    })
    expect(sidecarMock.unstageHunk).not.toHaveBeenCalled()
  })

  it('unstages a hunk from the staged side', async () => {
    mockPartiallyStagedDiff()
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Unstage hunk' }))
    await waitFor(() => {
      expect(sidecarMock.unstageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -1,2 +1,2 @@ staged-first'
      )
    })
    expect(sidecarMock.stageHunk).not.toHaveBeenCalled()
  })

  it('recovers when the hunk mutation rejects outright', async () => {
    mockPartiallyStagedDiff()
    sidecarMock.stageHunk.mockRejectedValue(new Error('sidecar is gone'))
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Stage hunk' })).not.toBeDisabled()
    })
    expect(screen.getAllByTestId('diff-hunk')).toHaveLength(1)
  })

  it('keeps a staged hunk on screen until its refetch lands, then lets it leave the side', async () => {
    const lastHunk = hunkAt('@@ -30,2 +30,2 @@ last', 30, 30)
    let unstagedCalls = 0
    let resolveStageHunk: () => void = () => {}
    let resolveUnstagedRefetch: () => void = () => {}

    sidecarMock.getDiff.mockImplementation(
      async (_repo: string, _file: string, staged: boolean) => {
        if (staged) {
          return emptyDiff
        }
        unstagedCalls++
        if (unstagedCalls === 1) {
          return diffWith([lastHunk])
        }
        return new Promise((resolve) => {
          resolveUnstagedRefetch = () => resolve(emptyDiff)
        })
      }
    )
    sidecarMock.stageHunk.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStageHunk = () => resolve({ _tag: 'Ok' })
        })
    )

    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Stage hunk' }))

    const pendingCheckbox = await screen.findByRole('checkbox', { name: 'Unstage hunk' })
    expect(pendingCheckbox).toBeDisabled()
    expect(screen.getAllByTestId('diff-hunk')).toHaveLength(1)

    resolveStageHunk()

    await waitFor(() => {
      expect(unstagedCalls).toBeGreaterThan(1)
    })
    expect(screen.getAllByTestId('diff-hunk')).toHaveLength(1)

    resolveUnstagedRefetch()

    await waitFor(() => {
      expect(screen.getByText('No changes to show.')).toBeInTheDocument()
    })
  })

  it('syntax-highlights diff lines for known languages', async () => {
    sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) =>
      staged
        ? emptyDiff
        : {
            _tag: 'Ok' as const,
            patch: '',
            diff: {
              filePath: 'src/app.ts',
              binary: false,
              hunks: [
                {
                  header: '@@ -1,1 +1,2 @@',
                  oldStart: 1,
                  oldCount: 1,
                  newStart: 1,
                  newCount: 2,
                  lines: [
                    { kind: 'context' as const, text: 'const base = 1', oldLine: 1, newLine: 1 },
                    { kind: 'add' as const, text: 'const added = 2', oldLine: null, newLine: 2 }
                  ]
                }
              ]
            }
          }
    )
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await waitFor(() => {
      const keywords = screen
        .getAllByText('const')
        .filter((element) => element.getAttribute('style')?.includes('--shiki-dark'))
      expect(keywords).toHaveLength(2)
    })
  })

  it('renders plain text for files without a known language', async () => {
    sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) =>
      staged
        ? { _tag: 'Ok' as const, patch: '', diff: { filePath: 'NOTES', binary: false, hunks: [] } }
        : {
            _tag: 'Ok' as const,
            patch: '',
            diff: {
              filePath: 'NOTES',
              binary: false,
              hunks: [
                {
                  header: '@@ -1,1 +1,1 @@',
                  oldStart: 1,
                  oldCount: 1,
                  newStart: 1,
                  newCount: 1,
                  lines: [
                    {
                      kind: 'add' as const,
                      text: 'const looks like code',
                      oldLine: null,
                      newLine: 1
                    }
                  ]
                }
              ]
            }
          }
    )
    sidecarMock.getStatus.mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: ['NOTES'],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    await renderDiffPanel({ file: 'NOTES', group: 'unstaged' })

    const plainLine = await screen.findByText('const looks like code')
    expect(plainLine.querySelector('span')).toBeNull()
  })

  it('renders a binary notice instead of hunks', async () => {
    sidecarMock.getDiff.mockResolvedValue({
      _tag: 'Ok',
      patch: '',
      diff: { filePath: 'logo.png', binary: true, hunks: [] }
    })
    await renderDiffPanel({ file: 'logo.png', group: 'unstaged' })

    expect(await screen.findByText(/Binary file/)).toBeInTheDocument()
  })

  it('omits the +/- totals for a binary file, which has no lines to count', async () => {
    sidecarMock.getDiff.mockResolvedValue({
      _tag: 'Ok',
      patch: '',
      diff: { filePath: 'logo.png', binary: true, hunks: [] }
    })
    await renderDiffPanel({ file: 'logo.png', group: 'unstaged' })

    await screen.findByText(/Binary file/)
    expect(screen.queryByText('+0')).not.toBeInTheDocument()
    expect(screen.queryByText('−0')).not.toBeInTheDocument()
  })

  it('reports a failed diff read', async () => {
    sidecarMock.getDiff.mockResolvedValue({ _tag: 'GitError', message: 'bad object' })
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    expect(await screen.findByText(/Failed to load diff/)).toBeInTheDocument()
  })

  it('hides hunk actions for untracked files', async () => {
    sidecarMock.getStatus.mockResolvedValue({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: ['src/app.ts'],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    })
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByText('@@ -1,3 +1,4 @@')
    expect(screen.queryByRole('checkbox', { name: 'Stage hunk' })).not.toBeInTheDocument()
  })

  it('renders a drop checkbox per hunk for a head-commit file and reports a hunk drop on toggle', async () => {
    const onToggleHunk = vi.fn()
    await renderDiffPanel(
      { file: 'src/app.ts', source: 'head-commit', range: 'HEAD~1..HEAD' },
      { dropState: 'kept', isHunkDropped: () => false, onToggleFile: vi.fn(), onToggleHunk }
    )

    await screen.findByText('@@ -1,3 +1,4 @@')
    const checkbox = screen.getByRole('checkbox', { name: 'Drop hunk' })
    expect(checkbox).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Stage hunk' })).not.toBeInTheDocument()

    fireEvent.click(checkbox)
    expect(onToggleHunk).toHaveBeenCalledWith('@@ -1,3 +1,4 @@', ['@@ -1,3 +1,4 @@'])
  })

  it('renders a commit file read-only, with no staging or drop controls at all', async () => {
    await renderDiffPanel({ file: 'src/app.ts', source: 'commit', commit: 'feedface' })

    await screen.findByText('@@ -1,3 +1,4 @@')
    expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'src/app.ts', false, {
      range: undefined,
      commit: 'feedface',
      renameSource: undefined
    })
    expect(screen.queryAllByRole('checkbox')).toEqual([])
  })

  it('passes the rename source so a renamed file in a commit reads as a rename', async () => {
    await renderDiffPanel({
      file: 'new.ts',
      renameSource: 'old.ts',
      source: 'commit',
      commit: 'feedface'
    })

    await waitFor(() => {
      expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'new.ts', false, {
        range: undefined,
        commit: 'feedface',
        renameSource: 'old.ts'
      })
    })
  })

  it('renders a tri-state file drop checkbox for a head-commit file', async () => {
    const onToggleFile = vi.fn()
    await renderDiffPanel(
      { file: 'src/app.ts', source: 'head-commit', range: 'HEAD~1..HEAD' },
      { dropState: 'partial', isHunkDropped: () => false, onToggleFile, onToggleHunk: vi.fn() }
    )

    const fileCheckbox = await screen.findByRole('checkbox', {
      name: 'Keep src/app.ts in last commit'
    })
    expect((fileCheckbox as HTMLInputElement).indeterminate).toBe(true)

    fireEvent.click(fileCheckbox)
    expect(onToggleFile).toHaveBeenCalled()
  })
})
