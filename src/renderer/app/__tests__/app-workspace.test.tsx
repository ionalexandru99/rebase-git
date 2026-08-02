import { CreateBranch, CreateTag, StashApply } from '@shared/rpc'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { localBranchesResponse, remoteRefsResponse } from '../../../test/builders'
import { renderApp } from '../../../test/render-app'
import { mockBranchResponses, setupLogStream, sidecarMock } from '../../../test/setup'
import {
  branchesMock,
  mockBaseAPI,
  mockSuccessfulRepo,
  openRepoMock,
  renderWithRepo,
  statusMock
} from './app-test-harness'

describe('App — open repository workspace', () => {
  it('renders the repo dashboard with name, branch, and change counts', async () => {
    await renderWithRepo()

    await waitFor(() => {
      expect(screen.getAllByText('my-app').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('feature/ui').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText(/4 changed files, 2 staged/)).toBeInTheDocument()
    })
  })

  it('refreshes the sidebar current branch after double-click checkout', async () => {
    mockBaseAPI({
      workingDirectory: '/home/user/projects',
      scanRepos: ['/home/user/projects/my-app']
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoMock)
    vi.mocked(sidecarMock.getStatus)
      .mockResolvedValueOnce({
        ...statusMock,
        status: { ...statusMock.status, current: 'develop' }
      })
      .mockResolvedValue({
        ...statusMock,
        status: { ...statusMock.status, current: 'main' }
      })
    vi.mocked(sidecarMock.getLocalBranches)
      .mockResolvedValueOnce(
        localBranchesResponse({ current: 'develop', all: ['main', 'develop'] })
      )
      .mockResolvedValue(localBranchesResponse({ all: ['main', 'develop'] }))
    vi.mocked(sidecarMock.getRemoteRefs).mockResolvedValue(remoteRefsResponse())
    vi.mocked(sidecarMock.checkout).mockResolvedValue({
      _tag: 'Ok',
      checkedOut: 'main'
    })
    setupLogStream()

    renderApp()

    fireEvent.click(await screen.findByText('/home/user/projects/my-app'))
    const developRow = (await screen.findByTitle('develop')).closest(
      '[data-testid="ref-tree-leaf-row"]'
    )
    expect(developRow).toBeTruthy()

    fireEvent.dblClick(screen.getByTitle('main'))

    await waitFor(() => {
      expect(sidecarMock.checkout).toHaveBeenCalledWith(
        '/home/user/projects/my-app',
        'local',
        'main'
      )
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      const mainRow = screen.getByTitle('main').closest('[data-testid="ref-tree-leaf-row"]')
      expect(mainRow).toBeTruthy()
      expect(within(mainRow as HTMLElement).getByTestId('current-ref-check')).toBeInTheDocument()
    })
  })

  it('keeps a tag start point qualified when creating a branch from the ref tree', async () => {
    let createBranchBody: Record<string, unknown> | undefined
    sidecarMock.respond(CreateBranch, (body) => {
      createBranchBody = body
      return { _tag: 'Ok' }
    })
    await renderWithRepo({ ...branchesMock, tags: ['v1'] })
    fireEvent.click(screen.getByText('Tags'))
    fireEvent.contextMenu(await screen.findByTitle('v1'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New branch from here' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Branch name' }), {
      target: { value: 'release-fix' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createBranchBody).toBeDefined())
    expect(createBranchBody).toMatchObject({
      startPoint: 'v1',
      startPointKind: 'tag'
    })
  })

  it('keeps a branch target qualified when creating a tag from the ref tree', async () => {
    let createTagBody: Record<string, unknown> | undefined
    sidecarMock.respond(CreateTag, (body) => {
      createTagBody = body
      return { _tag: 'Ok' }
    })
    await renderWithRepo()
    fireEvent.contextMenu(await screen.findByTitle('main'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Create tag here' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag name' }), {
      target: { value: 'v2' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createTagBody).toBeDefined())
    expect(createTagBody).toMatchObject({
      ref: 'main',
      refKind: 'local'
    })
  })

  it('submits the rendered stash OID when applying a stash', async () => {
    let stashApplyBody: Record<string, unknown> | undefined
    sidecarMock.stashList.mockResolvedValue({
      _tag: 'Ok',
      stashes: [
        {
          index: 0,
          ref: 'stash@{0}',
          oid: 'stash-oid-0',
          message: 'work in progress',
          branch: 'feature/ui'
        }
      ]
    })
    sidecarMock.respond(StashApply, (body) => {
      stashApplyBody = body
      return { _tag: 'Ok' }
    })
    await renderWithRepo()

    fireEvent.dblClick(await screen.findByText('work in progress'))

    await waitFor(() => expect(stashApplyBody).toBeDefined())
    expect(stashApplyBody).toMatchObject({ index: 0, expectedOid: 'stash-oid-0' })
  })

  it('keeps the timeline and the detail pane on screen at once, with no view switcher', async () => {
    await renderWithRepo()

    expect(
      await within(screen.getByRole('region', { name: 'Commits' })).findByText('Initial commit')
    ).toBeVisible()
    expect(screen.getByRole('region', { name: 'Commits' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByTestId('status-dock')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Local changes' })).not.toBeInTheDocument()
  })

  it('swaps the detail pane to the staging surface when the working copy is picked', async () => {
    await renderWithRepo()
    await within(screen.getByRole('region', { name: 'Commits' })).findByText('Initial commit')

    fireEvent.click(screen.getByTestId('working-copy-row'))

    expect(await screen.findByText('4 files · 2 staged')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toBeVisible()
  })

  it('does not expose a Close repository control — closing the tab is the only exit', async () => {
    await renderWithRepo()

    expect(screen.queryByRole('button', { name: /Close repository/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch repository/i })).not.toBeInTheDocument()
  })

  it('shows the clean working-tree state when no changes are pending', async () => {
    mockBaseAPI({
      workingDirectory: '/workspace',
      scanRepos: ['/workspace/repo']
    })
    mockSuccessfulRepo('/workspace/repo')
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    const stream = setupLogStream()

    renderApp()
    const repoRow = await screen.findByText('/workspace/repo')
    fireEvent.click(repoRow)
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalled()
    })
    stream.fireDone('/workspace/repo', false)

    fireEvent.click(await screen.findByTestId('working-copy-row'))
    await waitFor(() => {
      expect(screen.getByText('Working tree clean')).toBeInTheDocument()
    })
  })

  it('does not show a clean state or hide Amend while commit availability is loading', async () => {
    mockBaseAPI({
      workingDirectory: '/workspace',
      scanRepos: ['/workspace/repo']
    })
    mockSuccessfulRepo('/workspace/repo')
    mockBranchResponses({ current: 'main', all: ['main'], remotes: [], tags: [] })
    const stream = setupLogStream()
    let resolveStart: (() => void) | undefined
    vi.mocked(window.electronAPI.startLogStream).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = () => resolve({ _tag: 'Ok' })
        })
    )

    renderApp()
    fireEvent.click(await screen.findByText('/workspace/repo'))
    fireEvent.click(await screen.findByTestId('working-copy-row'))

    const amend = await screen.findByRole('checkbox', { name: 'Amend last commit' })
    expect(amend).toBeDisabled()
    expect(screen.queryByText('Working tree clean')).not.toBeInTheDocument()

    await act(async () => {
      resolveStart?.()
      stream.fire({
        repoPath: '/workspace/repo',
        commits: [
          {
            hash: 'abc123',
            message: 'Initial commit',
            author_name: 'Test User',
            date: '2026-01-01',
            parents: [],
            refs: 'HEAD -> main'
          }
        ]
      })
      stream.fireDone('/workspace/repo', false)
    })

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Amend last commit' })).toBeEnabled()
    })
  })
})
