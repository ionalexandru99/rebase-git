import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommitPanelView } from '../CommitPanelView'

function viewElement(overrides: Partial<Parameters<typeof CommitPanelView>[0]> = {}) {
  return (
    <CommitPanelView
      message={overrides.message ?? ''}
      amend={overrides.amend ?? false}
      amendAvailable={overrides.amendAvailable ?? false}
      amendDisabled={overrides.amendDisabled ?? false}
      loading={overrides.loading ?? false}
      branch={overrides.branch ?? 'main'}
      stagedCount={overrides.stagedCount ?? 2}
      concludesMerge={overrides.concludesMerge ?? false}
      commitBlockedReason={overrides.commitBlockedReason}
      identityCallout={overrides.identityCallout}
      hasDroppedFiles={overrides.hasDroppedFiles ?? false}
      expectedHeadAvailable={overrides.expectedHeadAvailable ?? true}
      onMessageChange={overrides.onMessageChange ?? vi.fn()}
      onAmendChange={overrides.onAmendChange ?? vi.fn()}
      onCommit={overrides.onCommit ?? vi.fn()}
    />
  )
}

function renderView(overrides: Partial<Parameters<typeof CommitPanelView>[0]> = {}) {
  return render(viewElement(overrides))
}

describe('CommitPanelView', () => {
  it('renders the message, branch and staged-file action', () => {
    renderView({ message: 'fix bug', branch: 'feature/ui', stagedCount: 4 })

    expect(screen.getByRole('textbox')).toHaveValue('fix bug')
    expect(screen.getByTestId('commit-branch-chip')).toHaveTextContent('feature/ui')
    expect(screen.getByRole('button', { name: 'Commit 4 files' })).toBeEnabled()
    expect(screen.queryByText('4 staged')).not.toBeInTheDocument()
    expect(screen.queryByText(/^↑\d/)).not.toBeInTheDocument()
  })

  it('uses the amend and merge action labels for those modes', () => {
    const view = renderView({ message: 'rewrite', amend: true })
    expect(screen.getByRole('button', { name: 'Amend' })).toBeEnabled()

    view.rerender(viewElement({ message: 'merge', concludesMerge: true, stagedCount: 0 }))
    expect(screen.getByRole('button', { name: 'Commit merge' })).toBeEnabled()
  })

  it('disables commits that have no message or staged changes', () => {
    const view = renderView()
    expect(screen.getByRole('button', { name: 'Commit 2 files' })).toBeDisabled()

    view.rerender(viewElement({ message: 'message', stagedCount: 0 }))
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
  })

  it('disables the rendered action while loading, blocked, or missing the amend HEAD', () => {
    const view = renderView({ message: 'message', loading: true })
    expect(screen.getByRole('button', { name: 'Committing…' })).toBeDisabled()

    view.rerender(
      viewElement({
        message: 'merge',
        stagedCount: 0,
        concludesMerge: true,
        commitBlockedReason: 'Commit blocked.'
      })
    )
    expect(screen.getByRole('button', { name: 'Commit merge' })).toBeDisabled()

    view.rerender(viewElement({ message: 'message', amend: true, expectedHeadAvailable: false }))
    expect(screen.getByRole('button', { name: 'Amend' })).toBeDisabled()
  })

  it('renders blocking and dropped-file explanations', () => {
    renderView({ commitBlockedReason: 'Resolve conflicts first.', hasDroppedFiles: true })

    expect(screen.getByText('Resolve conflicts first.')).toBeInTheDocument()
    expect(screen.getByText(/staged changes in dropped files will also be excluded/i)).toBeVisible()
  })

  it('renders the identity callout and refuses the commit while it is up', () => {
    const view = renderView({ message: 'message' })
    expect(screen.getByRole('button', { name: 'Commit 2 files' })).toBeEnabled()

    view.rerender(viewElement({ message: 'message', identityCallout: <p>Tell git who you are</p> }))

    expect(screen.getByText('Tell git who you are')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commit 2 files' })).toBeDisabled()
  })

  it('shows and disables the amend control from view state', () => {
    const view = renderView()
    expect(screen.queryByRole('checkbox', { name: /amend last commit/i })).not.toBeInTheDocument()

    view.rerender(viewElement({ amendAvailable: true, amendDisabled: true }))
    expect(screen.getByRole('checkbox', { name: /amend last commit/i })).toBeDisabled()
  })

  it('reports message, amend and commit intent through callbacks', () => {
    const onMessageChange = vi.fn()
    const onAmendChange = vi.fn()
    const onCommit = vi.fn()
    renderView({
      message: 'message',
      amendAvailable: true,
      onMessageChange,
      onAmendChange,
      onCommit
    })

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'next message' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /amend last commit/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit 2 files' }))

    expect(onMessageChange).toHaveBeenCalledWith('next message')
    expect(onAmendChange).toHaveBeenCalledWith(true)
    expect(onCommit).toHaveBeenCalledOnce()
  })

  it('grows with multiline messages and caps the row count', () => {
    const view = renderView({ message: 'one line' })
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '1')

    view.rerender(viewElement({ message: 'subject\n\nbody' }))
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '3')

    view.rerender(viewElement({ message: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj' }))
    expect(Number(screen.getByRole('textbox').getAttribute('rows'))).toBeLessThanOrEqual(6)

    view.rerender(viewElement())
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '1')
  })

  it('updates the subject-length counter from the first line', () => {
    const view = renderView()
    expect(screen.getByText(/0 \/ 72/)).toBeInTheDocument()

    view.rerender(viewElement({ message: 'short subject\nbody' }))
    expect(screen.getByText(/13 \/ 72/)).toBeInTheDocument()
  })
})
