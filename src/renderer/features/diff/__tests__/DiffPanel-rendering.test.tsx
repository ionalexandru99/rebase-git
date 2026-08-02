import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { statusResponse } from '../../../../test/builders'
import { sidecarMock } from '../../../../test/setup'
import {
  emptyDiff,
  lastFileDiffOptions,
  mockDiffOn,
  renderDiffPanel,
  repoPath,
  stagedSides
} from './diff-panel-test-harness'

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
    sidecarMock.getStatus.mockResolvedValue(statusResponse({ not_added: ['src/app.ts'] }))
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stage file' }))

    await waitFor(() => {
      expect(sidecarMock.stageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    })
  })

  it('offers no file staging for a conflicted file', async () => {
    sidecarMock.getStatus.mockResolvedValue(
      statusResponse({
        conflicted: ['src/app.ts'],
        files: [{ path: 'src/app.ts', index: 'U', working_dir: 'U' }]
      })
    )
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
