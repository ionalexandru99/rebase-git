import { act, screen } from '@testing-library/react'
import { type CSSProperties, type ReactNode, useEffect } from 'react'
import { beforeEach, vi } from 'vitest'
import { type WorkspaceContextValue, WorkspaceProvider } from '@/app/WorkspaceContext'
import type { ConfirmRequest } from '@/components/ui/prompt-dialog'
import { DiffPanel } from '@/features/diff/DiffPanel'
import type { SelectedFile } from '@/features/status/StatusPanel'
import { GitStoreProvider, type RepoSession, useRepoSession } from '@/stores/git'
import {
  localBranchesResponse,
  openedRepoResponse,
  remoteRefsResponse,
  statusResponse
} from '../../../../test/builders'
import { renderWithQuery } from '../../../../test/render-app'
import { setupLogStream, sidecarMock } from '../../../../test/setup'

export interface HoveredLine {
  lineNumber: number
  side: 'additions' | 'deletions'
}

export interface SelectedRowSpec {
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

export const repoPath = '/home/user/project'

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

export function fixtureDiff(file: string, hunks: FixtureHunk[]) {
  const patch = `${[
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunks.flatMap((hunk) => [fixtureHeader(hunk), ...hunk.body])
  ].join('\n')}\n`
  return { _tag: 'Ok' as const, patch, binary: false }
}

export const firstHunk: FixtureHunk = {
  oldStart: 1,
  oldCount: 3,
  newStart: 1,
  newCount: 3,
  body: ['-const first = 1', '+const first = 2', ' const second = 3', ' const third = 4']
}

export const tailHunk: FixtureHunk = {
  oldStart: 28,
  oldCount: 3,
  newStart: 28,
  newCount: 3,
  context: 'function tail() {',
  body: [' const a = 5', '-const removed = 6', '+const added = 7', ' const b = 8']
}

export const twoHunkDiff = fixtureDiff('src/app.ts', [firstHunk, tailHunk])
export const emptyDiff = fixtureDiff('src/app.ts', [])

export function mockDiffOn(side: 'unstaged' | 'staged', diff = twoHunkDiff) {
  sidecarMock.getDiff.mockImplementation(async (_repo: string, _file: string, staged: boolean) =>
    staged === (side === 'staged') ? diff : emptyDiff
  )
}

export const stagedSides = () =>
  sidecarMock.getDiff.mock.calls.map((call: unknown[]) => call[2] as boolean)

export const lastFileDiffOptions = () => {
  const nodes = screen.getAllByTestId('pierre-file-diff')
  return JSON.parse(nodes[nodes.length - 1].getAttribute('data-options') ?? '{}')
}

export const lastChangeCounts = () => {
  const nodes = screen.getAllByTestId('pierre-file-diff')
  return JSON.parse(nodes[nodes.length - 1].getAttribute('data-change-counts') ?? '[]')
}

export function setHoveredLine(hovered: HoveredLine | undefined): void {
  pierreControl.hovered = hovered
}

export function setSelectedRows(rows: SelectedRowSpec[]): void {
  pierreControl.selectedRows = rows
}

export function lastCapturedFileDiffOptions(): unknown {
  const latest = pierreControl.captured[pierreControl.captured.length - 1]
  return latest?.options
}

export function hoverLine(lineNumber: number, side: 'additions' | 'deletions') {
  pierreControl.hovered = { lineNumber, side }
  const latest = pierreControl.captured[pierreControl.captured.length - 1]
  const options = latest?.options as
    | { onLineEnter?: (props: { lineNumber: number; annotationSide: string }) => void }
    | undefined
  act(() => {
    options?.onLineEnter?.({ lineNumber, annotationSide: side })
  })
}

export async function endLineSelection(range: { start: number; end: number } | null) {
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
  useEffect(() => {
    props.onSession(session)
  }, [props.onSession, session])
  return <DiffPanel selected={props.selected} amendDrop={props.amendDrop} />
}

export const confirmRequests: ConfirmRequest[] = []

export async function renderDiffPanel(selected: SelectedFile | null, amendDrop?: AmendDrop) {
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
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openedRepoResponse(repoPath))
  vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
  vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  setupLogStream()
  sidecarMock.getStatus.mockResolvedValue(statusResponse({ modified: ['src/app.ts'] }))
  sidecarMock.getLocalBranches.mockResolvedValue(localBranchesResponse())
  sidecarMock.getRemoteRefs.mockResolvedValue(remoteRefsResponse())
  mockDiffOn('unstaged')
  sidecarMock.stageFile.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.unstageFile.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.stageHunk.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.unstageHunk.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.discardHunk.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.stageLines.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.unstageLines.mockResolvedValue({ _tag: 'Ok' })
})
