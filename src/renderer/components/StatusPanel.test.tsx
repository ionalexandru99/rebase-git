import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusPanel } from '@/components/StatusPanel'
import type { GitStatus } from '@/types'

function renderPanel(props: {
  status: GitStatus | null
  onStage?: (file: string) => void
  onUnstage?: (file: string) => void
  loading?: boolean
}) {
  return render(
    <StatusPanel
      status={props.status}
      onStage={props.onStage ?? vi.fn()}
      onUnstage={props.onUnstage ?? vi.fn()}
      loading={props.loading ?? false}
    />
  )
}

describe('StatusPanel', () => {
  it('renders nothing when status is null', () => {
    const { container } = renderPanel({ status: null })
    expect(container.firstChild).toBeNull()
  })

  it('renders the section titles and counts when status has files', () => {
    renderPanel({
      status: {
        current: 'main',
        modified: ['a.ts', 'b.ts'],
        staged: ['c.ts'],
        not_added: ['d.ts']
      }
    })

    expect(screen.getByText('Working Directory')).toBeInTheDocument()
    expect(screen.getByText(/4 pending changes/)).toBeInTheDocument()
    expect(screen.getByText('Modified')).toBeInTheDocument()
    expect(screen.getByText('Staged')).toBeInTheDocument()
    expect(screen.getByText('Untracked')).toBeInTheDocument()
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('c.ts')).toBeInTheDocument()
    expect(screen.getByText('d.ts')).toBeInTheDocument()
  })

  it('shows the clean badge and empty placeholders when nothing has changed', () => {
    renderPanel({
      status: { current: 'main', modified: [], staged: [], not_added: [] }
    })

    expect(screen.getByText('Clean working tree')).toBeInTheDocument()
    expect(screen.getByText('Clean')).toBeInTheDocument()
    expect(screen.getByText('No modified files')).toBeInTheDocument()
    expect(screen.getByText('No staged files')).toBeInTheDocument()
    expect(screen.getByText('No untracked files')).toBeInTheDocument()
  })

  it('shows a loading badge when loading and hides the clean badge', () => {
    renderPanel({
      status: { current: 'main', modified: [], staged: [], not_added: [] },
      loading: true
    })

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByText('Clean')).not.toBeInTheDocument()
  })

  it('invokes onStage when the Stage button is clicked', () => {
    const onStage = vi.fn()
    renderPanel({
      status: {
        current: 'main',
        modified: ['index.ts'],
        staged: [],
        not_added: []
      },
      onStage
    })

    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    expect(onStage).toHaveBeenCalledWith('index.ts')
  })

  it('invokes onUnstage when the Unstage button is clicked', () => {
    const onUnstage = vi.fn()
    renderPanel({
      status: {
        current: 'main',
        modified: [],
        staged: ['index.ts'],
        not_added: []
      },
      onUnstage
    })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage' }))
    expect(onUnstage).toHaveBeenCalledWith('index.ts')
  })

  it('shows singular pending-change copy', () => {
    renderPanel({
      status: { current: 'main', modified: ['a.ts'], staged: [], not_added: [] }
    })

    expect(screen.getByText('1 pending change')).toBeInTheDocument()
  })

  describe('file name scroll', () => {
    afterEach(() => vi.restoreAllMocks())

    it('does not set data-scrollable when the file name fits', () => {
      // jsdom reports scrollWidth and clientWidth as 0, so overflow is 0
      const { container } = renderPanel({
        status: { current: 'main', modified: ['short.ts'], staged: [], not_added: [] }
      })
      const wraps = container.querySelectorAll('.sp-file-wrap')
      for (const wrap of wraps) {
        expect(wrap).not.toHaveAttribute('data-scrollable')
      }
    })

    it('sets data-scrollable and --sp-scroll-dist when the file name overflows', () => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180)

      const { container } = renderPanel({
        status: {
          current: 'main',
          modified: ['src/very/deep/nested/path/component.tsx'],
          staged: [],
          not_added: []
        }
      })

      const wrap = container.querySelector('.sp-file-wrap') as HTMLElement
      expect(wrap).toHaveAttribute('data-scrollable')
      expect(wrap.style.getPropertyValue('--sp-scroll-dist')).toBe('-220px')
    })
  })
})
