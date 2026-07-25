import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPACT_MEDIA_QUERY } from '@/lib/breakpoints'
import { Shell } from '../Shell'

function installViewport(compact: boolean) {
  const compactQuery = {
    matches: compact,
    media: COMPACT_MEDIA_QUERY,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  } as MediaQueryList
  const otherQuery = { ...compactQuery, matches: false } as MediaQueryList
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    query === COMPACT_MEDIA_QUERY ? compactQuery : otherQuery
  )
}

function renderShell() {
  render(
    <Shell
      repo={{ repoName: 'acme', repoPath: '/home/user/acme', branch: 'main', changes: 0 }}
      branchBrowser={{
        repoPath: '/home/user/acme',
        localBranches: ['main'],
        remoteBranches: [],
        tags: []
      }}
      navigation={{ activeView: 'history', onSelectView: vi.fn() }}
    >
      <div>workspace</div>
    </Shell>
  )
}

async function openCompactOverlay(): Promise<HTMLElement> {
  renderShell()
  fireEvent.click(await screen.findByRole('button', { name: 'Show branches' }))
  await screen.findByRole('searchbox', { name: 'Filter refs' })
  return screen.getByRole('dialog', { name: 'Branches' })
}

function backdropOf(overlay: HTMLElement): HTMLElement {
  const backdrop = overlay.previousElementSibling
  if (!(backdrop instanceof HTMLElement)) {
    throw new Error('expected a backdrop element before the overlay')
  }
  return backdrop
}

beforeEach(() => {
  vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Shell compact sidebar overlay', () => {
  it('opens the branches overlay from the toolbar and closes it from the overlay', async () => {
    installViewport(true)
    renderShell()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Show branches' }))

    const overlay = screen.getByRole('dialog', { name: 'Branches' })
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(await screen.findByRole('searchbox', { name: 'Filter refs' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close branches' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show branches' })).toBeInTheDocument()
  })

  it('closes the overlay when Escape is pressed and restores focus to the toggle', async () => {
    installViewport(true)
    await openCompactOverlay()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show branches' }))
  })

  it('dismisses the overlay through a backdrop that is hidden from assistive tech', async () => {
    installViewport(true)
    const backdrop = backdropOf(await openCompactOverlay())

    expect(backdrop.tagName).toBe('DIV')
    expect(backdrop).toHaveAttribute('aria-hidden', 'true')
    expect(backdrop).not.toHaveAttribute('tabindex')

    fireEvent.click(backdrop)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('docks the sidebar without an overlay above the compact width', async () => {
    installViewport(false)
    renderShell()

    expect(await screen.findByRole('button', { name: 'Hide branches' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Branches' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close branches' })).not.toBeInTheDocument()
  })
})
