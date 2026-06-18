import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/../test/render-app'
import { setupLogStream, sidecarMock } from '@/../test/setup'
import { DiffPanel } from '@/components/DiffPanel'
import type { SelectedFile } from '@/components/StatusPanel'
import { type GitStore, useGitStore } from '@/stores/git'

const repoPath = '/home/user/project'

const sampleDiff = {
  _tag: 'Ok' as const,
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
  diff: { filePath: 'src/app.ts', binary: false, hunks: [] }
}

// The panel fetches both the unstaged (staged=false) and staged (staged=true)
// diff for a file; route the sample to one side and leave the other empty.
function mockDiffOn(side: 'unstaged' | 'staged') {
  sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) =>
    staged === (side === 'staged') ? sampleDiff : emptyDiff
  )
}

// Highlighted lines are split into token spans, so match on the cell's full textContent.
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
  diff: {
    filePath: 'src/app.ts',
    binary: false,
    hunks
  }
})

function mockPartiallyStagedDiff() {
  sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) => ({
    _tag: 'Ok' as const,
    diff: {
      filePath: 'src/app.ts',
      binary: false,
      hunks: staged
        ? [hunkAt('@@ -1,2 +1,2 @@ staged-first', 1, 1)]
        : [hunkAt('@@ -30,2 +30,2 @@ unstaged-second', 30, 30)]
    }
  }))
}

interface HarnessProps {
  tabActive: boolean
  selected: SelectedFile | null
  onGit: (git: GitStore) => void
}

function DiffPanelHarness(props: HarnessProps) {
  const git = useGitStore('diff-test-tab', props.tabActive)
  props.onGit(git)
  return <DiffPanel git={git} selected={props.selected} />
}

async function renderDiffPanel(selected: SelectedFile | null) {
  let git: GitStore | undefined
  renderWithQuery(() => (
    <DiffPanelHarness
      tabActive={true}
      selected={selected}
      onGit={(store) => {
        git = store
      }}
    />
  ))
  if (!git) {
    throw new Error('git store not initialized')
  }
  const store = git
  await act(async () => {
    await store.openRepo(repoPath)
  })
  return store
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
    await renderDiffPanel({ file: 'src/app.ts' })

    await waitFor(() => {
      expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'src/app.ts', false)
      expect(screen.getByText('@@ -1,3 +1,4 @@')).toBeInTheDocument()
    })
    expect(getRenderedDiffLine('line two added')).toBeInTheDocument()
    expect(getRenderedDiffLine('line removed')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('renders no per-hunk buttons, only checkboxes', async () => {
    await renderDiffPanel({ file: 'src/app.ts' })

    await screen.findByText('@@ -1,3 +1,4 @@')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unstage hunk' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Stage hunk' })).toBeInTheDocument()
  })

  it('renders staged and unstaged hunks as one list in document order', async () => {
    mockPartiallyStagedDiff()
    await renderDiffPanel({ file: 'src/app.ts' })

    await screen.findByText('@@ -30,2 +30,2 @@ unstaged-second')
    const stagedHunkCheckbox = screen.getByRole('checkbox', { name: 'Unstage hunk' })
    const unstagedHunkCheckbox = screen.getByRole('checkbox', { name: 'Stage hunk' })
    expect((stagedHunkCheckbox as HTMLInputElement).checked).toBe(true)
    expect((unstagedHunkCheckbox as HTMLInputElement).checked).toBe(false)
    expect(
      stagedHunkCheckbox.compareDocumentPosition(unstagedHunkCheckbox) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByText('Unstaged')).not.toBeInTheDocument()
    expect(screen.queryByText('Staged')).not.toBeInTheDocument()
  })

  it('remaps displayed line numbers to HEAD coordinates and keeps the original header for ops', async () => {
    sidecarMock.getDiff.mockImplementation(
      async (_repo: string, _file: string, staged: boolean) => ({
        _tag: 'Ok' as const,
        diff: {
          filePath: 'src/app.ts',
          binary: false,
          hunks: staged
            ? [
                {
                  header: '@@ -1,3 +1,4 @@',
                  oldStart: 1,
                  oldCount: 3,
                  newStart: 1,
                  newCount: 4,
                  lines: [{ kind: 'add' as const, text: 'import added', oldLine: null, newLine: 1 }]
                }
              ]
            : [
                {
                  header: '@@ -7,18 +7,19 @@ interface FileRowProps {',
                  oldStart: 7,
                  oldCount: 18,
                  newStart: 7,
                  newCount: 19,
                  lines: [
                    { kind: 'context' as const, text: 'file: string', oldLine: 7, newLine: 7 }
                  ]
                }
              ]
        }
      })
    )
    await renderDiffPanel({ file: 'src/app.ts' })

    // The staged hunk above adds one line to the index, so the unstaged hunk's index-side
    // numbers shift back to HEAD coordinates: -7,18 displays as -6,18.
    await screen.findByText('@@ -6,18 +7,19 @@ interface FileRowProps {')
    expect(screen.queryByText('@@ -7,18 +7,19 @@ interface FileRowProps {')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Stage hunk' }))
    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -7,18 +7,19 @@ interface FileRowProps {'
      )
    })
  })

  it('shows a tri-state file checkbox in the header that stages the remaining hunks', async () => {
    mockPartiallyStagedDiff()
    sidecarMock.stageFile.mockResolvedValue({ _tag: 'Ok' })
    await renderDiffPanel({ file: 'src/app.ts' })

    const fileCheckbox = await screen.findByRole('checkbox', { name: 'Stage src/app.ts' })
    expect((fileCheckbox as HTMLInputElement).indeterminate).toBe(true)
    expect((fileCheckbox as HTMLInputElement).checked).toBe(false)

    fireEvent.click(fileCheckbox)
    await waitFor(() => {
      expect(sidecarMock.stageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    })
  })

  it('shows a checked file checkbox when every hunk is staged and unstages on click', async () => {
    mockDiffOn('staged')
    sidecarMock.unstageFile.mockResolvedValue({ _tag: 'Ok' })
    await renderDiffPanel({ file: 'src/app.ts' })

    const fileCheckbox = await screen.findByRole('checkbox', { name: 'Unstage src/app.ts' })
    expect((fileCheckbox as HTMLInputElement).checked).toBe(true)
    expect((fileCheckbox as HTMLInputElement).indeterminate).toBe(false)

    fireEvent.click(fileCheckbox)
    await waitFor(() => {
      expect(sidecarMock.unstageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    })
  })

  it('toggles hunk staging through the hunk checkbox', async () => {
    mockPartiallyStagedDiff()
    await renderDiffPanel({ file: 'src/app.ts' })

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Stage hunk' }))
    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -30,2 +30,2 @@ unstaged-second'
      )
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Unstage hunk' }))
    await waitFor(() => {
      expect(sidecarMock.unstageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -1,2 +1,2 @@ staged-first'
      )
    })
  })

  it('keeps the last staged hunk single while staged and unstaged diffs refetch separately', async () => {
    const lastHunk = hunkAt('@@ -30,2 +30,2 @@ last', 30, 30)
    let stagedCalls = 0
    let unstagedCalls = 0
    let resolveStageHunk: () => void = () => {}
    let resolveUnstagedRefetch: () => void = () => {}

    sidecarMock.getStatus
      .mockResolvedValueOnce({
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
      .mockResolvedValue({
        _tag: 'Ok',
        status: {
          current: 'main',
          modified: [],
          staged: ['src/app.ts'],
          not_added: [],
          conflicted: [],
          deleted: [],
          created: [],
          renamed: [],
          files: []
        }
      })
    sidecarMock.getDiff.mockImplementation(
      async (_repo: string, _file: string, staged: boolean) => {
        if (staged) {
          stagedCalls++
          return stagedCalls === 1 ? emptyDiff : diffWith([lastHunk])
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

    await renderDiffPanel({ file: 'src/app.ts' })

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Stage hunk' }))

    const pendingCheckbox = await screen.findByRole('checkbox', { name: 'Unstage hunk' })
    expect(pendingCheckbox).toBeDisabled()
    expect(screen.getAllByTestId('diff-hunk')).toHaveLength(1)

    resolveStageHunk()

    await waitFor(() => {
      expect(stagedCalls).toBeGreaterThan(1)
    })
    expect(screen.getAllByTestId('diff-hunk')).toHaveLength(1)
    expect(screen.queryByRole('checkbox', { name: 'Stage hunk' })).not.toBeInTheDocument()

    resolveUnstagedRefetch()

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Unstage hunk' })).not.toBeDisabled()
    })
    expect(screen.getAllByTestId('diff-hunk')).toHaveLength(1)
  })

  it('offers a whole-file stage action for unstaged files', async () => {
    sidecarMock.stageFile.mockResolvedValue({ _tag: 'Ok' })
    await renderDiffPanel({ file: 'src/app.ts' })

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Stage src/app.ts' }))

    await waitFor(() => {
      expect(sidecarMock.stageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    })
  })

  it('syntax-highlights diff lines for known languages', async () => {
    sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) =>
      staged
        ? emptyDiff
        : {
            _tag: 'Ok' as const,
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
    await renderDiffPanel({ file: 'src/app.ts' })

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
        ? { _tag: 'Ok' as const, diff: { filePath: 'NOTES', binary: false, hunks: [] } }
        : {
            _tag: 'Ok' as const,
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
    await renderDiffPanel({ file: 'NOTES' })

    const plainLine = await screen.findByText('const looks like code')
    expect(plainLine.querySelector('span')).toBeNull()
  })

  it('renders a binary notice instead of hunks', async () => {
    sidecarMock.getDiff.mockResolvedValue({
      _tag: 'Ok',
      diff: { filePath: 'logo.png', binary: true, hunks: [] }
    })
    await renderDiffPanel({ file: 'logo.png' })

    expect(await screen.findByText(/Binary file/)).toBeInTheDocument()
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
    await renderDiffPanel({ file: 'src/app.ts' })

    await screen.findByText('@@ -1,3 +1,4 @@')
    expect(screen.queryByRole('checkbox', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Stage src/app.ts' })).toBeInTheDocument()
  })
})
