import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { openedRepoResponse, statusResponse } from '../../../test/builders'
import { renderApp } from '../../../test/render-app'
import {
  mockBranchResponses,
  setupLogStream,
  setupRepoChanged,
  sidecarMock
} from '../../../test/setup'
import {
  branchesMock,
  mockBaseAPI,
  openRepoMock,
  sampleCommit,
  statusMock
} from './app-test-harness'

describe('App — repository tab ownership', () => {
  it('redirects to the existing tab when a third tab tries to open the same repo', async () => {
    mockBaseAPI({
      workingDirectory: '/projects',
      scanRepos: ['/projects/repo-a', '/projects/repo-b']
    })
    vi.mocked(window.electronAPI.openRepo).mockImplementation((path) =>
      Promise.resolve(openedRepoResponse(path))
    )
    sidecarMock.getStatus.mockResolvedValue(statusResponse())
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    setupLogStream()

    renderApp()

    fireEvent.click(await screen.findByText('/projects/repo-a'))
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
        '/projects/repo-a',
        expect.any(Number)
      )
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('repo-a')
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    const repoBMatches = await screen.findAllByText('/projects/repo-b')
    const repoBPickerRow = repoBMatches
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)
    fireEvent.click(repoBPickerRow as HTMLButtonElement)
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
        '/projects/repo-b',
        expect.any(Number)
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    const repoAPickerRow = (await screen.findAllByText('/projects/repo-a'))
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => !!b)
      .at(-1)
    expect(repoAPickerRow).toBeTruthy()
    fireEvent.click(repoAPickerRow as HTMLButtonElement)

    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('repo-a')
    })
    const remainingTabs = screen.getAllByRole('tab')
    expect(remainingTabs).toHaveLength(2)
    expect(remainingTabs[0]).toHaveAccessibleName('repo-a')
    expect(remainingTabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(remainingTabs[1]).toHaveAccessibleName('repo-b')
    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(2)
  })

  it('keeps a selected commit when an inactive tab finishes refreshing history', async () => {
    mockBaseAPI({
      workingDirectory: '/projects',
      scanRepos: ['/projects/repo-a', '/projects/repo-b']
    })
    vi.mocked(window.electronAPI.openRepo).mockImplementation((path) =>
      Promise.resolve({
        _tag: 'Ok',
        result: { path, remotes: {}, defaultBranch: 'feature/ui' }
      })
    )
    vi.mocked(sidecarMock.getStatus).mockResolvedValue(statusMock)
    mockBranchResponses(branchesMock)
    const stream = setupLogStream()
    const repoChanged = setupRepoChanged()
    const selectedCommit = {
      ...sampleCommit,
      hash: 'selected123',
      message: 'Selected commit',
      parents: [],
      refs: ''
    }
    const headCommit = {
      ...sampleCommit,
      hash: 'head123',
      message: 'Head commit',
      parents: [selectedCommit.hash]
    }
    vi.mocked(sidecarMock.getCommitDetail).mockImplementation(async (_repoPath, sha) => ({
      _tag: 'Ok',
      detail: {
        sha,
        author: { name: 'Jane Doe', email: 'jane@example.com' },
        authorDate: sampleCommit.date,
        subject: sha === selectedCommit.hash ? selectedCommit.message : headCommit.message,
        body: '',
        files: []
      }
    }))

    renderApp()

    fireEvent.click(await screen.findByText('/projects/repo-a'))
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/projects/repo-a', {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
    })
    await screen.findByTitle('main')
    stream.fire({ repoPath: '/projects/repo-a', commits: [headCommit, selectedCommit] })
    stream.fireDone('/projects/repo-a')

    const selectedRow = await screen.findByText(selectedCommit.message)
    fireEvent.click(selectedRow.closest('[data-testid="commit-row"]') as HTMLElement)
    await waitFor(() => {
      expect(selectedRow.closest('[data-testid="commit-row"]')).toHaveAttribute(
        'data-selected',
        'true'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    const repoBPickerRow = (await screen.findAllByText('/projects/repo-b'))
      .map((el) => el.closest('button'))
      .find((button): button is HTMLButtonElement => !!button)
    fireEvent.click(repoBPickerRow as HTMLButtonElement)
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/projects/repo-b', {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
    })

    repoChanged.fire({ repoPath: '/projects/repo-a', kind: 'refs' })
    await waitFor(() => {
      const repoAStreams = vi
        .mocked(window.electronAPI.startLogStream)
        .mock.calls.filter(([repoPath]) => repoPath === '/projects/repo-a')
      expect(repoAStreams).toHaveLength(2)
    })
    stream.fire({
      repoPath: '/projects/repo-a',
      commits: [{ ...headCommit, hash: 'hidden123', message: 'Hidden tab commit' }, selectedCommit]
    })
    stream.fireDone('/projects/repo-a')

    fireEvent.click(screen.getByRole('tab', { name: /repo-a/i }))

    expect(await screen.findByText('Hidden tab commit')).toBeVisible()
    const restoredSelectedRow = screen
      .getAllByTestId('commit-row')
      .find((row) => row.textContent?.includes(selectedCommit.message))
    expect(restoredSelectedRow).toHaveAttribute('data-selected', 'true')
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Details' })).toHaveTextContent(
        selectedCommit.message
      )
    })
  })

  it('switches to the existing tab instead of loading the repo twice', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)
    sidecarMock.getStatus.mockResolvedValue(statusMock)
    mockBranchResponses(branchesMock)
    setupLogStream()

    renderApp()

    const firstRow = await screen.findByText('/home/user/projects/my-app')
    fireEvent.click(firstRow)
    await waitFor(() => {
      expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Open new tab/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    const matches = await screen.findAllByText('/home/user/projects/my-app')
    const pickerRow = matches
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => !!b)
      .at(-1)
    expect(pickerRow).toBeTruthy()
    fireEvent.click(pickerRow as HTMLButtonElement)

    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('my-app')
    })
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
  })

  it('shows a banner when an openRepo error happens', async () => {
    mockBaseAPI({
      workingDirectory: '/workspace',
      scanRepos: ['/workspace/bad-repo']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'NotARepo'
    })

    renderApp()
    const repoRow = await screen.findByText('/workspace/bad-repo')
    fireEvent.click(repoRow)

    await waitFor(() => {
      expect(screen.getByText('Not a git repository')).toBeInTheDocument()
    })
  })
})
