import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CommitDiffSelection, CommitDiffView } from '@/features/diff/CommitDiffView'
import { GitStoreProvider, type RepoSession, useRepoSession } from '@/stores/git'
import { renderWithQuery } from '../../../../test/render-app'
import { setupLogStream, sidecarMock } from '../../../../test/setup'
import { COMBINED_DIFF_PATCH, MODIFY_PATCH } from './patch-fixtures'

vi.mock('../diff-theme', () => ({
  diffThemeStyle: () => ({ '--mock-diff-theme': 'on' }),
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

const diffEnvelope = (patch: string, overrides: { binary?: boolean } = {}) => ({
  _tag: 'Ok' as const,
  patch,
  diff: {
    filePath: 'simple.txt',
    binary: overrides.binary ?? false,
    hunks: [
      {
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 3,
        lines: [
          { kind: 'context' as const, text: 'line 1', oldLine: 1, newLine: 1 },
          { kind: 'del' as const, text: 'line 2', oldLine: 2, newLine: null },
          { kind: 'add' as const, text: 'line 2 EDITED', oldLine: null, newLine: 2 }
        ]
      }
    ]
  }
})

function Harness(props: {
  selected: CommitDiffSelection | null
  onSession: (session: RepoSession) => void
}) {
  return (
    <GitStoreProvider tabId="commit-diff-view-tab" tabActive={true}>
      <Probe selected={props.selected} onSession={props.onSession} />
    </GitStoreProvider>
  )
}

function Probe(props: {
  selected: CommitDiffSelection | null
  onSession: (session: RepoSession) => void
}) {
  props.onSession(useRepoSession())
  return <CommitDiffView selected={props.selected} />
}

async function renderView(selected: CommitDiffSelection | null) {
  let session: RepoSession | undefined
  const rendered = renderWithQuery(() => (
    <Harness
      selected={selected}
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
  return rendered
}

const selection: CommitDiffSelection = {
  commit: 'feedface',
  file: 'simple.txt',
  binary: false
}

beforeEach(() => {
  localStorage.clear()
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
  sidecarMock.getDiff.mockResolvedValue(diffEnvelope(MODIFY_PATCH))
})

describe('CommitDiffView', () => {
  it('shows an empty state when no file is selected', async () => {
    await renderView(null)

    expect(screen.getByText('No file selected')).toBeInTheDocument()
    expect(sidecarMock.getDiff).not.toHaveBeenCalled()
  })

  it('shows the loading copy while the diff is in flight', async () => {
    sidecarMock.getDiff.mockImplementation(() => new Promise(() => {}))

    await renderView(selection)

    expect(screen.getByText('Loading diff…')).toBeInTheDocument()
  })

  it('reports a failed diff read', async () => {
    sidecarMock.getDiff.mockResolvedValue({ _tag: 'GitError', message: 'bad object' })

    await renderView(selection)

    expect(await screen.findByText(/Failed to load diff/)).toBeInTheDocument()
  })

  it('shows the binary notice without fetching a diff', async () => {
    await renderView({ ...selection, file: 'blob.bin', binary: true })

    expect(screen.getByText('Binary file — no preview available.')).toBeInTheDocument()
    expect(sidecarMock.getDiff).not.toHaveBeenCalled()
  })

  it('shows no-changes copy when the patch parses to zero files', async () => {
    sidecarMock.getDiff.mockResolvedValue(diffEnvelope(''))

    await renderView(selection)

    expect(await screen.findByText('No changes to show.')).toBeInTheDocument()
  })

  it('renders the parsed file through the diff library in unified style', async () => {
    await renderView(selection)

    const fileDiff = await screen.findByTestId('pierre-file-diff')
    expect(fileDiff).toHaveAttribute('data-file', 'simple.txt')
    const options = JSON.parse(fileDiff.getAttribute('data-options') ?? '{}')
    expect(options.diffStyle).toBe('unified')
    expect(options.disableFileHeader).toBe(true)
    expect(options.unsafeCSS).toBe('mock-unsafe-css')
    expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'simple.txt', false, {
      range: undefined,
      commit: 'feedface',
      renameSource: undefined
    })
  })

  it('requests the rename source for a renamed file', async () => {
    await renderView({ ...selection, renameSource: 'old.txt' })

    await screen.findByTestId('pierre-file-diff')
    expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'simple.txt', false, {
      range: undefined,
      commit: 'feedface',
      renameSource: 'old.txt'
    })
  })

  it('shows the filename and line totals in its header', async () => {
    await renderView(selection)

    await screen.findByTestId('pierre-file-diff')
    expect(screen.getByText('simple.txt')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('keeps the diff body testid on a non-scrolling wrapper around the virtualizer', async () => {
    await renderView(selection)

    await screen.findByTestId('pierre-file-diff')
    const body = screen.getByTestId('diff-body')
    expect(body.className).toContain('overflow-hidden')
    const virtualizer = screen.getByTestId('pierre-virtualizer')
    expect(body.contains(virtualizer)).toBe(true)
    expect(virtualizer.className).toContain('scroll-host')
  })

  it('flips to split on toggle and persists the choice', async () => {
    const rendered = await renderView(selection)

    await screen.findByTestId('pierre-file-diff')
    const unifiedButton = screen.getByRole('button', { name: 'Unified' })
    const splitButton = screen.getByRole('button', { name: 'Split' })
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'true')
    expect(splitButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(splitButton)

    await waitFor(() => {
      const options = JSON.parse(
        screen.getByTestId('pierre-file-diff').getAttribute('data-options') ?? '{}'
      )
      expect(options.diffStyle).toBe('split')
    })
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Unified' })).toHaveAttribute('aria-pressed', 'false')
    expect(localStorage.getItem('rebase:diff-style')).toBe('split')

    rendered.unmount()
    await renderView(selection)

    await waitFor(() => {
      const options = JSON.parse(
        screen.getByTestId('pierre-file-diff').getAttribute('data-options') ?? '{}'
      )
      expect(options.diffStyle).toBe('split')
    })
  })

  it('falls back to the raw patch text when parsing fails', async () => {
    sidecarMock.getDiff.mockResolvedValue({
      _tag: 'Ok' as const,
      patch: COMBINED_DIFF_PATCH,
      diff: { filePath: 'conflict.txt', binary: false, hunks: [] }
    })

    await renderView({ ...selection, file: 'conflict.txt' })

    const raw = await screen.findByTestId('diff-raw-patch')
    expect(raw.textContent).toContain('diff --cc conflict.txt')
    expect(screen.queryByTestId('pierre-file-diff')).not.toBeInTheDocument()
  })
})
