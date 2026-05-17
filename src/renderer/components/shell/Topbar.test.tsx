import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Topbar } from '@/components/shell/Topbar'

function renderTopbar(overrides: Partial<Parameters<typeof Topbar>[0]> = {}) {
  return render(
    <Topbar
      repoName={overrides.repoName ?? 'my-repo'}
      repoPath={'repoPath' in overrides ? (overrides.repoPath ?? null) : '/home/user/my-repo'}
      branch={overrides.branch ?? 'main'}
      ahead={overrides.ahead ?? 0}
      behind={overrides.behind ?? 0}
      onFetch={overrides.onFetch}
      onPull={overrides.onPull}
      onPush={overrides.onPush}
    />
  )
}

describe('Topbar', () => {
  it('renders the repo name and branch', () => {
    renderTopbar({ repoName: 'acme', branch: 'feature/login' })
    expect(screen.getByText('acme')).toBeInTheDocument()
    expect(screen.getByText('feature/login')).toBeInTheDocument()
  })

  it('shows the first letter of the repo name in the icon', () => {
    renderTopbar({ repoName: 'zebra' })
    expect(screen.getByText('Z')).toBeInTheDocument()
  })

  it('shows the repo path', () => {
    renderTopbar({ repoPath: '/projects/acme' })
    expect(screen.getByText('/projects/acme')).toBeInTheDocument()
  })

  it('hides the repo path when repoPath is null', () => {
    renderTopbar({ repoPath: null })
    expect(screen.queryByText('/home/user/my-repo')).not.toBeInTheDocument()
  })

  it('shows the ahead indicator when ahead > 0', () => {
    renderTopbar({ ahead: 3 })
    expect(screen.getByText('↑')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows the behind indicator when behind > 0', () => {
    renderTopbar({ behind: 2 })
    expect(screen.getByText('↓')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('hides sync indicators when both are zero', () => {
    renderTopbar({ ahead: 0, behind: 0 })
    expect(screen.queryByText('↑')).not.toBeInTheDocument()
    expect(screen.queryByText('↓')).not.toBeInTheDocument()
  })

  it('disables the Push button when nothing is ahead', () => {
    renderTopbar({ ahead: 0 })
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled()
  })

  it('enables Push and shows the count when ahead > 0', () => {
    renderTopbar({ ahead: 5 })
    const btn = screen.getByRole('button', { name: 'Push 5' })
    expect(btn).not.toBeDisabled()
  })

  it('renders the repo chip as a non-interactive display, not a button', () => {
    renderTopbar({ repoName: 'acme' })
    expect(screen.queryByRole('button', { name: /repository/i })).not.toBeInTheDocument()
  })

  it('fires onFetch when Fetch is clicked', () => {
    const onFetch = vi.fn()
    renderTopbar({ onFetch })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('fires onPull when Pull is clicked', () => {
    const onPull = vi.fn()
    renderTopbar({ onPull })
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    expect(onPull).toHaveBeenCalledOnce()
  })

  it('fires onPush when Push is clicked and ahead > 0', () => {
    const onPush = vi.fn()
    renderTopbar({ onPush, ahead: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Push 1' }))
    expect(onPush).toHaveBeenCalledOnce()
  })

  describe('branch name marquee', () => {
    afterEach(() => vi.restoreAllMocks())

    function findMarqueeText(container: HTMLElement) {
      const text = container.querySelector('[data-marquee-wrap] > span') as HTMLElement | null
      if (!text) throw new Error('marquee text element not found')
      return text
    }

    it('does not animate when the branch name fits', () => {
      // jsdom reports scrollWidth and clientWidth as 0, so overflow is 0
      const { container } = renderTopbar({ branch: 'main' })
      const text = findMarqueeText(container)
      expect(text).not.toHaveAttribute('data-marquee')
      expect(text.className).not.toMatch(/animate-marquee/)
    })

    it('animates and sets --marquee-dist when the branch name overflows', () => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(160)

      const { container } = renderTopbar({ branch: 'feature/very-long-branch-name' })
      const text = findMarqueeText(container)

      expect(text).toHaveAttribute('data-marquee')
      expect(text.className).toMatch(/animate-marquee/)
      expect(text.style.getPropertyValue('--marquee-dist')).toBe('-140px')
    })

    it('stops animating when the branch changes to one that fits', () => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(160)

      const { container, rerender } = renderTopbar({ branch: 'feature/very-long-branch-name' })
      expect(findMarqueeText(container)).toHaveAttribute('data-marquee')

      // Restore normal dimensions so the re-rendered branch fits
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(40)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(160)

      rerender(
        <Topbar
          repoName="my-repo"
          repoPath="/home/user/my-repo"
          branch="main"
          ahead={0}
          behind={0}
        />
      )

      expect(findMarqueeText(container)).not.toHaveAttribute('data-marquee')
    })
  })
})
