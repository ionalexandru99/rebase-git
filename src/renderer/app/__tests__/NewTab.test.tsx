import type { CloneProgressEvent } from '@shared/schemas/ipc'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewTab, type WorkspaceCatalog } from '../NewTab'

const RECENTS = [
  '/home/user/code/alpha',
  '/home/user/code/bravo',
  '/home/user/code/charlie',
  '/home/user/code/delta',
  '/home/user/code/echo',
  '/home/user/code/foxtrot'
]

function catalog(overrides: Partial<WorkspaceCatalog> = {}): WorkspaceCatalog {
  return {
    recentRepos: RECENTS,
    discoveredRepos: [],
    workspaces: ['/home/user/code'],
    activeWorkspace: '/home/user/code',
    switchWorkspace: vi.fn(async () => {}),
    addWorkspace: vi.fn(async () => null),
    removeWorkspace: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    ...overrides
  }
}

beforeEach(() => {
  vi.mocked(window.electronAPI.onCloneProgress).mockReturnValue(() => {})
})

describe('NewTab recent repositories', () => {
  it('shows only the four most recent repositories', () => {
    render(<NewTab catalog={catalog()} onOpenRepo={vi.fn()} />)

    const cards = screen.getAllByTestId('repo-picker-recent')
    expect(cards).toHaveLength(4)
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('/home/user/code/alpha'),
      expect.stringContaining('/home/user/code/bravo'),
      expect.stringContaining('/home/user/code/charlie'),
      expect.stringContaining('/home/user/code/delta')
    ])
    expect(screen.queryByText('/home/user/code/echo')).toBeNull()
  })
})

// Cloning is offered with no workspace configured, so this screen has to be able to show the result:
// otherwise closing the cloned tab leaves the repository unreachable.
describe('NewTab with no workspace', () => {
  const noWorkspace = () => catalog({ workspaces: [], activeWorkspace: null, discoveredRepos: [] })

  // Every recent, not the four the full picker caps at: this screen has no search and no workspace
  // listing, so a card that falls off this list is a repository with no way back to it.
  it('still offers the clone and lists everything that has been cloned already', () => {
    const onOpenRepo = vi.fn()
    render(<NewTab catalog={noWorkspace()} onOpenRepo={onOpenRepo} />)

    expect(screen.getByRole('button', { name: /Clone…/ })).toBeTruthy()
    const cards = screen.getAllByTestId('repo-picker-recent')
    expect(cards).toHaveLength(RECENTS.length)

    fireEvent.click(cards[0])
    expect(onOpenRepo).toHaveBeenCalledWith('/home/user/code/alpha')
  })

  it('shows only the add-workspace prompt when nothing has been cloned yet', () => {
    render(<NewTab catalog={catalog({ ...noWorkspace(), recentRepos: [] })} onOpenRepo={vi.fn()} />)

    expect(screen.queryAllByTestId('repo-picker-recent')).toHaveLength(0)
    expect(screen.getByText('Add a workspace')).toBeTruthy()
  })
})

describe('NewTab clone flow', () => {
  it('clones into the active workspace and opens the result in the tab', async () => {
    const onOpenRepo = vi.fn()
    let emitProgress: ((event: CloneProgressEvent) => void) | undefined
    vi.mocked(window.electronAPI.onCloneProgress).mockImplementation((callback) => {
      emitProgress = callback
      return () => {}
    })
    let progressWhileCloning = ''
    vi.mocked(window.electronAPI.cloneRepo).mockImplementation(async (request) => {
      emitProgress?.({ cloneId: request.cloneId, phase: 'Receiving objects', percent: 64 })
      await Promise.resolve()
      progressWhileCloning = screen.getByTestId('clone-progress').textContent ?? ''
      return { _tag: 'Ok', path: '/home/user/code/repo' }
    })

    render(<NewTab catalog={catalog()} onOpenRepo={onOpenRepo} />)
    fireEvent.click(screen.getByRole('button', { name: /Clone…/ }))

    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/owner/repo.git' }
    })
    // The folder git is about to create stays readable on its own; only the parent path truncates.
    const folderSegment = screen.getByText('/repo')
    expect(folderSegment.parentElement?.textContent).toBe('/home/user/code/repo')

    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))

    await waitFor(() => {
      expect(onOpenRepo).toHaveBeenCalledWith('/home/user/code/repo')
    })
    expect(progressWhileCloning).toContain('Receiving objects')
    expect(progressWhileCloning).toContain('64%')
    expect(window.electronAPI.cloneRepo).toHaveBeenCalledWith({
      cloneId: expect.any(Number),
      url: 'https://github.com/owner/repo.git',
      parentDir: '/home/user/code',
      folderName: 'repo'
    })
  })

  // Without this the clone is missing from every later new tab until a restart: recents and the
  // workspace listing are both read once at startup.
  it('puts the clone into the live catalog, and does not on failure', async () => {
    const cloned = catalog()
    vi.mocked(window.electronAPI.cloneRepo).mockResolvedValue({
      _tag: 'Ok',
      path: '/home/user/code/repo'
    })

    const { unmount } = render(<NewTab catalog={cloned} onOpenRepo={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Clone…/ }))
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/owner/repo.git' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))

    await waitFor(() => {
      expect(cloned.refresh).toHaveBeenCalled()
    })
    unmount()

    const failed = catalog()
    vi.mocked(window.electronAPI.cloneRepo).mockResolvedValue({
      _tag: 'GitError',
      message: 'fatal: repository not found'
    })
    render(<NewTab catalog={failed} onOpenRepo={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Clone…/ }))
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/owner/missing.git' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))

    expect(await screen.findByText('fatal: repository not found')).toBeTruthy()
    expect(failed.refresh).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and shows the git message when the clone fails', async () => {
    vi.mocked(window.electronAPI.cloneRepo).mockResolvedValue({
      _tag: 'GitError',
      message: 'fatal: Authentication failed'
    })
    const onOpenRepo = vi.fn()

    render(<NewTab catalog={catalog()} onOpenRepo={onOpenRepo} />)
    fireEvent.click(screen.getByRole('button', { name: /Clone…/ }))
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/owner/repo.git' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))

    expect(await screen.findByText('fatal: Authentication failed')).toBeTruthy()
    expect(onOpenRepo).not.toHaveBeenCalled()
  })

  it('refuses to submit a URL git could not clone', () => {
    render(<NewTab catalog={catalog()} onOpenRepo={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Clone…/ }))
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: '--upload-pack=evil' }
    })

    expect(screen.getByRole('button', { name: 'Clone' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Enter an HTTPS or SSH repository URL/)).toBeTruthy()
  })
})
