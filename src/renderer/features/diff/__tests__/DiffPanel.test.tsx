import { fingerprintHunk } from '@shared/hunk-fingerprint'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type WorkspaceContextValue, WorkspaceProvider } from '@/app/WorkspaceContext'
import type { ConfirmRequest } from '@/components/ui/prompt-dialog'
import { DiffPanel } from '@/features/diff/DiffPanel'
import type { SelectedFile } from '@/features/status/StatusPanel'
import { GitStoreProvider, type RepoSession, useRepoSession } from '@/stores/git'
import { renderWithQuery } from '../../../../test/render-app'
import { setupLogStream, setupRepoChanged, sidecarMock } from '../../../../test/setup'

interface HoveredLine {
  lineNumber: number
  side: 'additions' | 'deletions'
}

interface SelectedRowSpec {
  line: number
  type: 'change-addition' | 'change-deletion' | 'context'
  index: string
}

const pierreControl = vi.hoisted(() => ({
  hovered: undefined as HoveredLine | undefined,
  captured: [] as Array<Record<string, unknown>>,
  selectedRows: [] as SelectedRowSpec[]
}))

const DiffsHost = vi.hoisted(() => 'diffs-container' as unknown as 'div')

vi.mock('@pierre/diffs/react', () => ({
  Virtualizer: (props: { children?: ReactNode; className?: string; style?: CSSProperties }) => (
    <div data-testid="pierre-virtualizer">{props.children}</div>
  ),
  FileDiff: (props: Record<string, unknown>) => {
    pierreControl.captured.push(props)
    const fileDiff = props.fileDiff as {
      name: string
      hunks: Array<{ hunkContent: Array<{ type: string }> }>
    }
    const options = { ...(props.options as Record<string, unknown>) }
    delete options.onLineEnter
    delete options.onLineLeave
    delete options.onLineSelectionEnd
    const renderGutterUtility = props.renderGutterUtility as
      | ((getHoveredLine: () => HoveredLine | undefined) => ReactNode)
      | undefined
    const renderAnnotation = props.renderAnnotation as
      | ((annotation: { lineNumber: number; side: string }) => ReactNode)
      | undefined
    const lineAnnotations = (props.lineAnnotations ?? []) as Array<{
      lineNumber: number
      side: string
    }>
    return (
      <div
        data-testid="pierre-file-diff"
        data-file={fileDiff.name}
        data-options={JSON.stringify(options)}
        data-change-counts={JSON.stringify(
          fileDiff.hunks.map(
            (hunk) => hunk.hunkContent.filter((content) => content.type === 'change').length
          )
        )}
      >
        <div data-testid="pierre-gutter">{renderGutterUtility?.(() => pierreControl.hovered)}</div>
        <DiffsHost>
          {pierreControl.selectedRows.map((row) => (
            <div
              key={`${row.type}:${row.index}`}
              data-selected-line=""
              data-line={row.line}
              data-line-type={row.type}
              data-line-index={row.index}
            />
          ))}
        </DiffsHost>
        {lineAnnotations.map((annotation) => (
          <div
            key={`${annotation.side}:${annotation.lineNumber}`}
            data-testid="pierre-annotation"
            data-line={annotation.lineNumber}
            data-side={annotation.side}
          >
            {renderAnnotation?.(annotation)}
          </div>
        ))}
      </div>
    )
  }
}))

const repoPath = '/home/user/project'

interface FixtureHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  context?: string
  body: string[]
}

function fixtureHeader(hunk: FixtureHunk): string {
  const suffix = hunk.context ? ` ${hunk.context}` : ''
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@${suffix}`
}

function fixtureDiff(file: string, hunks: FixtureHunk[]) {
  const patch = `${[
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunks.flatMap((hunk) => [fixtureHeader(hunk), ...hunk.body])
  ].join('\n')}\n`
  return { _tag: 'Ok' as const, patch, binary: false }
}

const firstHunk: FixtureHunk = {
  oldStart: 1,
  oldCount: 3,
  newStart: 1,
  newCount: 3,
  body: ['-const first = 1', '+const first = 2', ' const second = 3', ' const third = 4']
}

const tailHunk: FixtureHunk = {
  oldStart: 28,
  oldCount: 3,
  newStart: 28,
  newCount: 3,
  context: 'function tail() {',
  body: [' const a = 5', '-const removed = 6', '+const added = 7', ' const b = 8']
}

const twoHunkDiff = fixtureDiff('src/app.ts', [firstHunk, tailHunk])
const emptyDiff = fixtureDiff('src/app.ts', [])

function mockDiffOn(side: 'unstaged' | 'staged', diff = twoHunkDiff) {
  sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) =>
    staged === (side === 'staged') ? diff : emptyDiff
  )
}

const stagedSides = () =>
  sidecarMock.getDiff.mock.calls.map((call: unknown[]) => call[2] as boolean)

const lastFileDiffOptions = () => {
  const nodes = screen.getAllByTestId('pierre-file-diff')
  return JSON.parse(nodes[nodes.length - 1].getAttribute('data-options') ?? '{}')
}

const lastChangeCounts = () => {
  const nodes = screen.getAllByTestId('pierre-file-diff')
  return JSON.parse(nodes[nodes.length - 1].getAttribute('data-change-counts') ?? '[]')
}

function hoverLine(lineNumber: number, side: 'additions' | 'deletions') {
  pierreControl.hovered = { lineNumber, side }
  const latest = pierreControl.captured[pierreControl.captured.length - 1]
  const options = latest?.options as
    | { onLineEnter?: (props: { lineNumber: number; annotationSide: string }) => void }
    | undefined
  act(() => {
    options?.onLineEnter?.({ lineNumber, annotationSide: side })
  })
}

async function endLineSelection(range: { start: number; end: number } | null) {
  const latest = pierreControl.captured[pierreControl.captured.length - 1]
  const options = latest?.options as
    | { onLineSelectionEnd?: (range: { start: number; end: number } | null) => void }
    | undefined
  await act(async () => {
    options?.onLineSelectionEnd?.(range)
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined))
    })
  })
}

type AmendDrop = Parameters<typeof DiffPanel>[0]['amendDrop']

interface HarnessProps {
  selected: SelectedFile | null
  amendDrop?: AmendDrop
  confirm: (request: ConfirmRequest) => void
  onSession: (session: RepoSession) => void
}

function DiffPanelHarness(props: HarnessProps) {
  const workspace = {
    actions: {},
    stashList: {},
    prompt: () => {},
    confirm: props.confirm
  } as unknown as WorkspaceContextValue
  return (
    <GitStoreProvider tabId="diff-test-tab" tabActive={true}>
      <WorkspaceProvider value={workspace}>
        <DiffPanelProbe
          selected={props.selected}
          amendDrop={props.amendDrop}
          onSession={props.onSession}
        />
      </WorkspaceProvider>
    </GitStoreProvider>
  )
}

function DiffPanelProbe(props: Pick<HarnessProps, 'selected' | 'amendDrop' | 'onSession'>) {
  const session = useRepoSession()
  props.onSession(session)
  return <DiffPanel selected={props.selected} amendDrop={props.amendDrop} />
}

const confirmRequests: ConfirmRequest[] = []

async function renderDiffPanel(selected: SelectedFile | null, amendDrop?: AmendDrop) {
  let session: RepoSession | undefined
  renderWithQuery(() => (
    <DiffPanelHarness
      selected={selected}
      amendDrop={amendDrop}
      confirm={(request) => confirmRequests.push(request)}
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
  pierreControl.hovered = undefined
  pierreControl.captured = []
  pierreControl.selectedRows = []
  confirmRequests.length = 0
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
  sidecarMock.stageFile.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.unstageFile.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.stageHunk.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.unstageHunk.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.discardHunk.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.stageLines.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.unstageLines.mockResolvedValue({ _tag: 'Ok' })
})

describe('DiffPanel rendering', () => {
  it('shows an empty state when no file is selected', async () => {
    await renderDiffPanel(null)
    expect(screen.getByText('No file selected')).toBeInTheDocument()
  })

  it('renders the worktree diff through the @pierre/diffs renderer with interactive options', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    const fileDiff = await screen.findByTestId('pierre-file-diff')
    expect(fileDiff).toHaveAttribute('data-file', 'src/app.ts')
    expect(screen.getByTestId('pierre-virtualizer')).toBeInTheDocument()
    const options = lastFileDiffOptions()
    expect(options.themeType).toBe('dark')
    expect(options.diffStyle).toBe('unified')
    expect(options.disableFileHeader).toBe(true)
    expect(options.enableGutterUtility).toBe(true)
  })

  it('shows the file name and +/- totals in the header', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.getByText('src/app.ts')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('−2')).toBeInTheDocument()
  })

  it('reads only the worktree side for a file selected in the unstaged group', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(stagedSides()).toEqual([false])
  })

  it('reads only the index side for a file selected in the staged group', async () => {
    mockDiffOn('staged')
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    expect(stagedSides()).toEqual([true])
  })

  it('renders a binary notice instead of a diff', async () => {
    sidecarMock.getDiff.mockResolvedValue({
      _tag: 'Ok',
      patch: 'Binary files a/logo.png and b/logo.png differ\n',
      binary: true
    })
    await renderDiffPanel({ file: 'logo.png', group: 'unstaged' })

    expect(await screen.findByText(/Binary file/)).toBeInTheDocument()
    expect(screen.queryByText('+0')).not.toBeInTheDocument()
  })

  it('reports a failed diff read', async () => {
    sidecarMock.getDiff.mockResolvedValue({ _tag: 'GitError', message: 'bad object' })
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    expect(await screen.findByText(/Failed to load diff/)).toBeInTheDocument()
  })

  it('shows no-changes text when the diff has no hunks', async () => {
    sidecarMock.getDiff.mockResolvedValue(emptyDiff)
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    expect(await screen.findByText('No changes to show.')).toBeInTheDocument()
  })
})

describe('DiffPanel file staging', () => {
  it('stages the whole worktree file from the diff header, keeping the totals', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.getByText('+2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stage file' }))

    await waitFor(() => {
      expect(sidecarMock.stageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    })
    expect(sidecarMock.unstageFile).not.toHaveBeenCalled()
  })

  it('unstages the whole file from the staged side', async () => {
    mockDiffOn('staged')
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: 'Stage file' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unstage file' }))

    await waitFor(() => {
      expect(sidecarMock.unstageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    })
  })

  it('carries the rename source when unstaging a renamed file', async () => {
    mockDiffOn('staged')
    await renderDiffPanel({ file: 'src/app.ts', renameSource: 'src/old.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    fireEvent.click(screen.getByRole('button', { name: 'Unstage file' }))

    await waitFor(() => {
      expect(sidecarMock.unstageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts', 'src/old.ts')
    })
  })

  it('still stages an untracked file whole, even though it has no hunk actions', async () => {
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

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stage file' }))

    await waitFor(() => {
      expect(sidecarMock.stageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    })
  })

  it('offers no file staging for a conflicted file', async () => {
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

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: /^(Stage|Unstage) file$/ })).not.toBeInTheDocument()
  })

  it('offers no file staging for a binary file', async () => {
    sidecarMock.getDiff.mockResolvedValue({
      _tag: 'Ok',
      patch: 'Binary files a/logo.png and b/logo.png differ\n',
      binary: true
    })
    await renderDiffPanel({ file: 'logo.png', group: 'unstaged' })

    await screen.findByText(/Binary file/)
    expect(screen.queryByRole('button', { name: /^(Stage|Unstage) file$/ })).not.toBeInTheDocument()
  })

  it('offers no file staging on the amend surface', async () => {
    await renderDiffPanel(
      { file: 'src/app.ts', source: 'head-commit', range: 'HEAD~1..HEAD' },
      {
        dropState: 'kept',
        isHunkDropped: () => false,
        onToggleFile: vi.fn(),
        onToggleHunk: vi.fn()
      }
    )

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: /^(Stage|Unstage) file$/ })).not.toBeInTheDocument()
  })
})

describe('DiffPanel hunk hover actions', () => {
  it('stages the hovered hunk with its exact header, resolved from an additions-side line', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    hoverLine(29, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -28,3 +28,3 @@ function tail() {'
      )
    })
    expect(sidecarMock.unstageHunk).not.toHaveBeenCalled()
    expect(sidecarMock.discardHunk).not.toHaveBeenCalled()
  })

  it('offers a working affordance for a hunk starting at line 1', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    hoverLine(1, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(repoPath, 'src/app.ts', '@@ -1,3 +1,3 @@')
    })
  })

  it('unstages the hovered hunk on the staged side', async () => {
    mockDiffOn('staged')
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard hunk' })).not.toBeInTheDocument()
    hoverLine(1, 'deletions')
    fireEvent.click(screen.getByRole('button', { name: 'Unstage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.unstageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -1,3 +1,3 @@'
      )
    })
  })

  it('ignores a click when nothing is hovered', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    pierreControl.hovered = undefined
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).not.toHaveBeenCalled()
    })
  })

  it('asks for confirmation before discarding a hunk, then discards on confirm', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    hoverLine(28, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Discard hunk' }))

    expect(sidecarMock.discardHunk).not.toHaveBeenCalled()
    expect(confirmRequests).toHaveLength(1)
    expect(confirmRequests[0].title).toBe('Discard hunk in src/app.ts?')
    expect(confirmRequests[0].destructive).toBe(true)

    await act(async () => {
      confirmRequests[0].onConfirm()
    })
    await waitFor(() => {
      expect(sidecarMock.discardHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -28,3 +28,3 @@ function tail() {'
      )
    })
  })

  it('removes the staged hunk optimistically until the refetch lands', async () => {
    let unstagedCalls = 0
    let resolveStageHunk: () => void = () => {}
    let resolveRefetch: () => void = () => {}
    sidecarMock.getDiff.mockImplementation(
      async (_repo: string, _file: string, staged: boolean) => {
        if (staged) {
          return emptyDiff
        }
        unstagedCalls++
        if (unstagedCalls === 1) {
          return twoHunkDiff
        }
        return new Promise((resolve) => {
          resolveRefetch = () => resolve(fixtureDiff('src/app.ts', [firstHunk]))
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
    await screen.findByTestId('pierre-file-diff')
    expect(lastChangeCounts()).toEqual([1, 1])

    hoverLine(29, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(lastChangeCounts()).toEqual([1, 0])
    })

    resolveStageHunk()
    await waitFor(() => {
      expect(unstagedCalls).toBeGreaterThan(1)
    })
    expect(lastChangeCounts()).toEqual([1, 0])

    resolveRefetch()
    await waitFor(() => {
      expect(lastChangeCounts()).toEqual([1])
    })
  })

  it('restores the hunk when the mutation rejects outright', async () => {
    sidecarMock.stageHunk.mockRejectedValue(new Error('sidecar is gone'))
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    hoverLine(1, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(lastChangeCounts()).toEqual([1, 1])
    })
  })

  it('offers no hunk actions for a conflicted file', async () => {
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

    await screen.findByTestId('pierre-file-diff')
    expect(stagedSides()).toEqual([false])
    expect(lastFileDiffOptions().enableGutterUtility).toBe(false)
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard hunk' })).not.toBeInTheDocument()
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

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableGutterUtility).toBe(false)
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
  })
})

describe('DiffPanel line selection', () => {
  const firstHeader = '@@ -1,3 +1,3 @@'
  const tailHeader = '@@ -28,3 +28,3 @@ function tail() {'

  it('enables line selection on the worktree surface', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableLineSelection).toBe(true)
  })

  it('stages the selected lines grouped by hunk and clears the selection', async () => {
    pierreControl.selectedRows = [
      { line: 1, type: 'change-addition', index: '1,0' },
      { line: 2, type: 'context', index: '2,1' },
      { line: 29, type: 'change-addition', index: '6,4' }
    ]
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 29 })

    const stageButton = screen.getByRole('button', { name: 'Stage 2 selected lines' })
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    fireEvent.click(stageButton)

    await waitFor(() => {
      expect(sidecarMock.stageLines).toHaveBeenCalledWith(repoPath, 'src/app.ts', [
        {
          hunkHeader: firstHeader,
          lineIndexes: [1],
          fingerprint: fingerprintHunk(twoHunkDiff.patch, firstHeader)
        },
        {
          hunkHeader: tailHeader,
          lineIndexes: [2],
          fingerprint: fingerprintHunk(twoHunkDiff.patch, tailHeader)
        }
      ])
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Stage 2 selected lines' })
      ).not.toBeInTheDocument()
    })
    expect(sidecarMock.unstageLines).not.toHaveBeenCalled()
  })

  it('unstages the selected lines on the staged side', async () => {
    mockDiffOn('staged')
    pierreControl.selectedRows = [{ line: 1, type: 'change-deletion', index: '0,0' }]
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage 1 selected line' }))

    await waitFor(() => {
      expect(sidecarMock.unstageLines).toHaveBeenCalledWith(repoPath, 'src/app.ts', [
        {
          hunkHeader: firstHeader,
          lineIndexes: [0],
          fingerprint: fingerprintHunk(twoHunkDiff.patch, firstHeader)
        }
      ])
    })
    expect(sidecarMock.stageLines).not.toHaveBeenCalled()
  })

  it('keeps the selection when the diff refetches with unchanged content', async () => {
    const repoChanged = setupRepoChanged()
    pierreControl.selectedRows = [{ line: 1, type: 'change-addition', index: '1,0' }]
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 1 })
    expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()

    const diffCallsBefore = sidecarMock.getDiff.mock.calls.length
    repoChanged.fire({ repoPath, kind: 'workingTree' })
    await waitFor(() => {
      expect(sidecarMock.getDiff.mock.calls.length).toBeGreaterThan(diffCallsBefore)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()
  })

  it('drops the previous selection as soon as a new sweep starts', async () => {
    pierreControl.selectedRows = [{ line: 1, type: 'change-addition', index: '1,0' }]
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })
    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 1 })
    expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()

    const latest = pierreControl.captured[pierreControl.captured.length - 1]
    const options = latest?.options as
      | { onLineSelectionEnd?: (range: { start: number; end: number } | null) => void }
      | undefined
    const diffNodes = screen.getAllByTestId('pierre-file-diff')
    const host = diffNodes[diffNodes.length - 1].querySelector('diffs-container')
    if (!host) {
      throw new Error('diffs host missing')
    }
    act(() => {
      host.querySelector('[data-selected-line]')?.remove()
      options?.onLineSelectionEnd?.({ start: 29, end: 29 })
    })

    expect(screen.queryByRole('button', { name: 'Stage 1 selected line' })).not.toBeInTheDocument()

    await act(async () => {
      const row = document.createElement('div')
      row.setAttribute('data-selected-line', '')
      row.setAttribute('data-line', '29')
      row.setAttribute('data-line-type', 'change-addition')
      row.setAttribute('data-line-index', '6,4')
      host.appendChild(row)
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()
    })
  })

  it('waits for selection marks that the library paints frames after selection end', async () => {
    pierreControl.selectedRows = []
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })
    await screen.findByTestId('pierre-file-diff')

    const latest = pierreControl.captured[pierreControl.captured.length - 1]
    const options = latest?.options as
      | { onLineSelectionEnd?: (range: { start: number; end: number } | null) => void }
      | undefined
    await act(async () => {
      options?.onLineSelectionEnd?.({ start: 1, end: 1 })
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      })
      const diffNodes = screen.getAllByTestId('pierre-file-diff')
      const host = diffNodes[diffNodes.length - 1].querySelector('diffs-container')
      if (!host) {
        throw new Error('diffs host missing')
      }
      const row = document.createElement('div')
      row.setAttribute('data-selected-line', '')
      row.setAttribute('data-line', '1')
      row.setAttribute('data-line-type', 'change-addition')
      row.setAttribute('data-line-index', '1,0')
      host.appendChild(row)
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()
    })
  })

  it('restores the hunk hover actions when the selection is cleared', async () => {
    pierreControl.selectedRows = [{ line: 1, type: 'change-addition', index: '1,0' }]
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 1 })
    expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()

    await endLineSelection(null)

    expect(screen.queryByRole('button', { name: 'Stage 1 selected line' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stage hunk' })).toBeInTheDocument()
    expect(sidecarMock.stageLines).not.toHaveBeenCalled()
  })

  it('offers no line action for a context-only selection', async () => {
    pierreControl.selectedRows = [
      { line: 2, type: 'context', index: '2,1' },
      { line: 3, type: 'context', index: '3,2' }
    ]
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 2, end: 3 })

    expect(screen.queryByRole('button', { name: /selected line/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stage hunk' })).toBeInTheDocument()
  })

  it('disables line selection for conflicted files', async () => {
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

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableLineSelection).toBe(false)
  })

  it('disables line selection for untracked files', async () => {
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

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableLineSelection).toBe(false)
  })

  it('disables line selection on the amend surface', async () => {
    await renderDiffPanel(
      { file: 'src/app.ts', source: 'head-commit', range: 'HEAD~1..HEAD' },
      {
        dropState: 'kept',
        isHunkDropped: () => false,
        onToggleFile: vi.fn(),
        onToggleHunk: vi.fn()
      }
    )

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableLineSelection).toBe(false)
  })
})

describe('DiffPanel keyboard access', () => {
  it('offers focusable per-hunk annotation buttons on the unstaged side', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.getAllByTestId('pierre-annotation')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Stage hunk 1 of 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard hunk 1 of 2' })).toBeInTheDocument()

    const stageSecond = screen.getByRole('button', { name: 'Stage hunk 2 of 2' })
    stageSecond.focus()
    fireEvent.click(stageSecond)

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -28,3 +28,3 @@ function tail() {'
      )
    })
  })

  it('offers a focusable unstage button per hunk on the staged side', async () => {
    mockDiffOn('staged')
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    const unstageFirst = screen.getByRole('button', { name: 'Unstage hunk 1 of 2' })
    unstageFirst.focus()
    fireEvent.click(unstageFirst)

    await waitFor(() => {
      expect(sidecarMock.unstageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -1,3 +1,3 @@'
      )
    })
  })

  it('confirms before a keyboard-initiated discard', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    fireEvent.click(screen.getByRole('button', { name: 'Discard hunk 2 of 2' }))

    expect(sidecarMock.discardHunk).not.toHaveBeenCalled()
    expect(confirmRequests).toHaveLength(1)

    await act(async () => {
      confirmRequests[0].onConfirm()
    })
    await waitFor(() => {
      expect(sidecarMock.discardHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -28,3 +28,3 @@ function tail() {'
      )
    })
  })

  it('offers focusable drop and keep buttons per hunk on the amend surface', async () => {
    const onToggleHunk = vi.fn()
    const droppedHeader = '@@ -1,3 +1,3 @@'
    await renderDiffPanel(
      { file: 'src/app.ts', source: 'head-commit', range: 'HEAD~1..HEAD' },
      {
        dropState: 'partial',
        isHunkDropped: (header) => header === droppedHeader,
        onToggleFile: vi.fn(),
        onToggleHunk
      }
    )

    await screen.findByTestId('pierre-file-diff')
    fireEvent.click(screen.getByRole('button', { name: 'Drop hunk 2 of 2' }))
    expect(onToggleHunk).toHaveBeenCalledWith('@@ -28,3 +28,3 @@ function tail() {', [
      '@@ -1,3 +1,3 @@',
      '@@ -28,3 +28,3 @@ function tail() {'
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Keep hunk 1 of 2' }))
    expect(onToggleHunk).toHaveBeenCalledWith(droppedHeader, [
      '@@ -1,3 +1,3 @@',
      '@@ -28,3 +28,3 @@ function tail() {'
    ])
  })

  it('offers no annotation buttons for a conflicted file', async () => {
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

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryAllByTestId('pierre-annotation')).toHaveLength(0)
  })
})

describe('DiffPanel amend surface', () => {
  const headSelection: SelectedFile = {
    file: 'src/app.ts',
    source: 'head-commit',
    range: 'HEAD~1..HEAD'
  }

  it('drops the hovered hunk and reports the full header list', async () => {
    const onToggleHunk = vi.fn()
    await renderDiffPanel(headSelection, {
      dropState: 'kept',
      isHunkDropped: () => false,
      onToggleFile: vi.fn(),
      onToggleHunk
    })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard hunk' })).not.toBeInTheDocument()

    hoverLine(29, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Drop hunk' }))

    expect(onToggleHunk).toHaveBeenCalledWith('@@ -28,3 +28,3 @@ function tail() {', [
      '@@ -1,3 +1,3 @@',
      '@@ -28,3 +28,3 @@ function tail() {'
    ])
  })

  it('offers Keep on a dropped hunk, both on hover and as a persistent annotation', async () => {
    const onToggleHunk = vi.fn()
    const droppedHeader = '@@ -1,3 +1,3 @@'
    await renderDiffPanel(headSelection, {
      dropState: 'partial',
      isHunkDropped: (header) => header === droppedHeader,
      onToggleFile: vi.fn(),
      onToggleHunk
    })

    await screen.findByTestId('pierre-file-diff')
    const annotations = screen.getAllByTestId('pierre-annotation')
    const droppedAnnotation = annotations.find((node) => node.getAttribute('data-line') === '1')
    expect(droppedAnnotation).toBeDefined()
    expect(droppedAnnotation).toHaveTextContent('Dropped from last commit')

    fireEvent.click(
      within(droppedAnnotation as HTMLElement).getByRole('button', { name: 'Keep hunk 1 of 2' })
    )
    expect(onToggleHunk).toHaveBeenCalledWith(droppedHeader, [
      '@@ -1,3 +1,3 @@',
      '@@ -28,3 +28,3 @@ function tail() {'
    ])

    hoverLine(1, 'additions')
    expect(screen.getByRole('button', { name: 'Keep hunk' })).toBeInTheDocument()
  })

  it('renders a tri-state file drop checkbox for a head-commit file', async () => {
    const onToggleFile = vi.fn()
    await renderDiffPanel(headSelection, {
      dropState: 'partial',
      isHunkDropped: () => false,
      onToggleFile,
      onToggleHunk: vi.fn()
    })

    const fileCheckbox = await screen.findByRole('checkbox', {
      name: 'Keep src/app.ts in last commit'
    })
    expect((fileCheckbox as HTMLInputElement).indeterminate).toBe(true)

    fireEvent.click(fileCheckbox)
    expect(onToggleFile).toHaveBeenCalled()
  })

  it('reads the head-commit range, not the worktree', async () => {
    await renderDiffPanel(headSelection, {
      dropState: 'kept',
      isHunkDropped: () => false,
      onToggleFile: vi.fn(),
      onToggleHunk: vi.fn()
    })

    await screen.findByTestId('pierre-file-diff')
    expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'src/app.ts', false, {
      range: 'HEAD~1..HEAD',
      commit: undefined,
      renameSource: undefined
    })
  })
})
