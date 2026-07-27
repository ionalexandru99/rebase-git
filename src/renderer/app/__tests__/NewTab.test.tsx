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

describe('NewTab clone flow', () => {
  it('clones into the active workspace and opens the result in the tab', async () => {
    const onOpenRepo = vi.fn()
    let emitProgress: ((event: CloneProgressEvent) => void) | undefined
    vi.mocked(window.electronAPI.onCloneProgress).mockImplementation((callback) => {
      emitProgress = callback
      return () => {}
    })
    vi.mocked(window.electronAPI.cloneRepo).mockImplementation(async (request) => {
      emitProgress?.({ cloneId: request.cloneId, phase: 'Receiving objects', percent: 64 })
      return { _tag: 'Ok', path: '/home/user/code/repo' }
    })

    render(<NewTab catalog={catalog()} onOpenRepo={onOpenRepo} />)
    fireEvent.click(screen.getByRole('button', { name: /Clone…/ }))

    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/owner/repo.git' }
    })
    expect(screen.getByText('/home/user/code/repo')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))

    await waitFor(() => {
      expect(onOpenRepo).toHaveBeenCalledWith('/home/user/code/repo')
    })
    expect(window.electronAPI.cloneRepo).toHaveBeenCalledWith({
      cloneId: expect.any(Number),
      url: 'https://github.com/owner/repo.git',
      parentDir: '/home/user/code',
      folderName: 'repo'
    })
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
