import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/../test/render-app'
import { setupLogStream, sidecarMock } from '@/../test/setup'
import { DiffPanel } from '@/components/DiffPanel'
import type { SelectedFile } from '@/components/StatusPanel'
import { type Accessor, createSignal } from '@/lib/react-compat'
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

interface HarnessProps {
  tabActive: Accessor<boolean>
  selected: Accessor<SelectedFile | null>
  onGit: (git: GitStore) => void
}

function DiffPanelHarness(props: HarnessProps) {
  const git = useGitStore('diff-test-tab', props.tabActive)
  props.onGit(git)
  return <DiffPanel git={git} selected={props.selected()} />
}

async function renderDiffPanel(selected: SelectedFile | null) {
  const [tabActive] = createSignal(true)
  const [selectedSignal] = createSignal(selected)
  let git: GitStore | undefined
  renderWithQuery(() => (
    <DiffPanelHarness
      tabActive={tabActive}
      selected={selectedSignal}
      onGit={(store) => {
        git = store
      }}
    />
  ))
  if (!git) {
    throw new Error('git store not initialized')
  }
  await git.openRepo(repoPath)
  return git
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
      renamed: []
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
  sidecarMock.getDiff.mockResolvedValue(sampleDiff)
  sidecarMock.stageHunk.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.unstageHunk.mockResolvedValue({ _tag: 'Ok' })
})

describe('DiffPanel', () => {
  it('shows an empty state when no file is selected', async () => {
    await renderDiffPanel(null)
    expect(screen.getByText('No file selected')).toBeInTheDocument()
  })

  it('loads and renders hunks with line numbers and +/- totals', async () => {
    await renderDiffPanel({ file: 'src/app.ts', staged: false })

    await waitFor(() => {
      expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'src/app.ts', false)
      expect(screen.getByText('@@ -1,3 +1,4 @@')).toBeInTheDocument()
    })
    expect(screen.getByText('line two added')).toBeInTheDocument()
    expect(screen.getByText('line removed')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('stages a hunk from the unstaged diff', async () => {
    await renderDiffPanel({ file: 'src/app.ts', staged: false })

    fireEvent.click(await screen.findByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(repoPath, 'src/app.ts', '@@ -1,3 +1,4 @@')
    })
  })

  it('unstages a hunk from the staged diff', async () => {
    await renderDiffPanel({ file: 'src/app.ts', staged: true })

    fireEvent.click(await screen.findByRole('button', { name: 'Unstage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.unstageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -1,3 +1,4 @@'
      )
    })
  })

  it('offers a whole-file stage action for unstaged files', async () => {
    sidecarMock.stageFile.mockResolvedValue({ _tag: 'Ok' })
    await renderDiffPanel({ file: 'src/app.ts', staged: false })

    fireEvent.click(await screen.findByRole('button', { name: 'Stage file' }))

    await waitFor(() => {
      expect(sidecarMock.stageFile).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    })
  })

  it('renders a binary notice instead of hunks', async () => {
    sidecarMock.getDiff.mockResolvedValue({
      _tag: 'Ok',
      diff: { filePath: 'logo.png', binary: true, hunks: [] }
    })
    await renderDiffPanel({ file: 'logo.png', staged: false })

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
        renamed: []
      }
    })
    await renderDiffPanel({ file: 'src/app.ts', staged: false })

    await screen.findByText('@@ -1,3 +1,4 @@')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stage file' })).toBeInTheDocument()
  })
})
