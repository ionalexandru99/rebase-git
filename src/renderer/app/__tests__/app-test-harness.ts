import { LOG_PAGE_SIZE } from '@shared/graph-config'
import type { GitStatus } from '@shared/schemas/git'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, vi } from 'vitest'
import { openedRepoResponse, statusResponse } from '../../../test/builders'
import { renderApp } from '../../../test/render-app'
import { mockBranchResponses, setupLogStream, sidecarMock } from '../../../test/setup'

beforeEach(() => {
  setupLogStream()
})

export function mockSuccessfulRepo(
  repoPath: string,
  statusOverrides: Partial<GitStatus> = {},
  defaultBranch = 'main'
) {
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(
    openedRepoResponse(repoPath, { defaultBranch })
  )
  sidecarMock.getStatus.mockResolvedValue(statusResponse(statusOverrides))
}

export function mockBaseAPI(
  overrides: Partial<{
    onboardingComplete: boolean | null
    workingDirectory: string | null
    recentRepos: string[]
    scanRepos: string[]
    workspaces: string[]
  }> = {}
) {
  const workspaces =
    overrides.workspaces ?? (overrides.workingDirectory ? [overrides.workingDirectory] : [])
  const active = overrides.workingDirectory ?? workspaces[0] ?? null

  vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(
    overrides.onboardingComplete ?? true
  )
  vi.mocked(window.electronAPI.getWorkspaces).mockResolvedValue(workspaces)
  vi.mocked(window.electronAPI.getActiveWorkspace).mockResolvedValue(active)
  vi.mocked(window.electronAPI.addWorkspace).mockImplementation(async (path) => [
    ...workspaces,
    path
  ])
  vi.mocked(window.electronAPI.removeWorkspace).mockImplementation(async (path) =>
    workspaces.filter((workspace) => workspace !== path)
  )
  vi.mocked(window.electronAPI.setActiveWorkspace).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getRecentRepos).mockResolvedValue(overrides.recentRepos ?? [])
  vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
    _tag: 'Ok',
    repos: overrides.scanRepos ?? []
  })
}

export const openRepoMock = openedRepoResponse('/home/user/projects/my-app', {
  defaultBranch: 'feature/ui'
})
export const statusMock = statusResponse({
  current: 'feature/ui',
  modified: ['src/a.ts'],
  staged: ['src/b.ts', 'src/c.ts'],
  not_added: ['new.ts']
})
export const branchesMock = {
  current: 'feature/ui',
  all: ['main', 'feature/ui'],
  remotes: [] as string[],
  tags: [] as string[]
}
export const sampleCommit = {
  hash: '1234567abc',
  message: 'Initial commit',
  author_name: 'Jane Doe',
  date: new Date().toISOString(),
  parents: [],
  refs: 'HEAD -> feature/ui'
}

export async function renderWithRepo(branches = branchesMock) {
  mockBaseAPI({
    workingDirectory: '/home/user/projects',
    scanRepos: ['/home/user/projects/my-app']
  })
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)
  vi.mocked(sidecarMock.getStatus).mockResolvedValue(statusMock)
  sidecarMock.getCommitDetail.mockImplementation(async (_repoPath, sha) => ({
    _tag: 'Ok',
    detail: {
      sha,
      author: { name: sampleCommit.author_name, email: 'jane@example.com' },
      authorDate: sampleCommit.date,
      subject: sampleCommit.message,
      body: '',
      files: []
    }
  }))
  mockBranchResponses(branches)
  const stream = setupLogStream()

  renderApp()

  const repoRow = await screen.findByText('/home/user/projects/my-app')
  fireEvent.click(repoRow)

  await waitFor(() => {
    expect(window.electronAPI.openRepo).toHaveBeenCalledWith(
      '/home/user/projects/my-app',
      expect.any(Number)
    )
  })

  await screen.findByRole('region', { name: 'Commits' })
  await waitFor(() => {
    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/home/user/projects/my-app', {
      skip: 0,
      maxCount: LOG_PAGE_SIZE,
      streamId: expect.any(Number)
    })
  })

  stream.fire({
    repoPath: '/home/user/projects/my-app',
    commits: [sampleCommit]
  })
  stream.fireDone('/home/user/projects/my-app')
  await waitFor(() => {
    expect(sidecarMock.getCommitDetail).toHaveBeenCalledWith(
      '/home/user/projects/my-app',
      sampleCommit.hash
    )
    expect(screen.getByTestId('commit-detail-sha')).toHaveTextContent('1234567')
  })
}
