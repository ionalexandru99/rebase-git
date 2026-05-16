import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HistoryPanel } from '@/components/HistoryPanel'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { GitLog } from '@/types'

function renderPanel(log: GitLog | null, loading = false) {
  return render(
    <TooltipProvider>
      <HistoryPanel log={log} loading={loading} />
    </TooltipProvider>
  )
}

describe('HistoryPanel', () => {
  it('shows the empty state when there are no commits', () => {
    renderPanel({ all: [], total: 0 })

    expect(screen.getByText('No commits yet')).toBeInTheDocument()
    expect(screen.getByText(/Make your first commit/)).toBeInTheDocument()
  })

  it('shows the empty state when log is null', () => {
    renderPanel(null)

    expect(screen.getByText('No commits yet')).toBeInTheDocument()
  })

  it('renders a commit list with hash, message, and author initials', () => {
    renderPanel({
      all: [
        {
          hash: '1234567890abcdef',
          message: 'Add support for sparse checkouts',
          author_name: 'Jane Doe',
          date: new Date().toISOString()
        },
        {
          hash: 'abcdef1234567890',
          message: 'Refactor commit panel',
          author_name: 'Alex Smith',
          date: new Date(Date.now() - 3600_000).toISOString()
        }
      ],
      total: 2
    })

    expect(screen.getByText('2 commits')).toBeInTheDocument()
    expect(screen.getByText('Add support for sparse checkouts')).toBeInTheDocument()
    expect(screen.getByText('Refactor commit panel')).toBeInTheDocument()
    expect(screen.getByText('1234567')).toBeInTheDocument()
    expect(screen.getByText('abcdef1')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getByText('AS')).toBeInTheDocument()
  })

  it('uses singular copy for one commit', () => {
    renderPanel({
      all: [
        {
          hash: 'aaa',
          message: 'one',
          author_name: 'Solo',
          date: new Date().toISOString()
        }
      ],
      total: 1
    })

    expect(screen.getByText('1 commit')).toBeInTheDocument()
  })

  it('shows the loading badge', () => {
    renderPanel({ all: [], total: 0 }, true)

    expect(screen.getByText('Loading')).toBeInTheDocument()
  })
})
