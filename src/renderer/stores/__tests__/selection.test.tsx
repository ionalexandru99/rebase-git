import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DetailSelectionProvider, useDetailSelection } from '../selection'

function Probe() {
  const selection = useDetailSelection()
  return (
    <div>
      <output data-testid="kind">{selection.selection?.kind ?? 'head'}</output>
      <output data-testid="shas">{[...selection.selectedShas].join(',')}</output>
      <button type="button" onClick={() => selection.selectWorkingCopy()}>
        pick working copy
      </button>
      <button
        type="button"
        onClick={() => selection.selectCommitAt('bbb', { toggle: false, range: false }, ordered)}
      >
        pick bbb
      </button>
      <button
        type="button"
        onClick={() => selection.selectCommitAt('ccc', { toggle: true, range: false }, ordered)}
      >
        add ccc
      </button>
      <button type="button" onClick={() => selection.pruneToCommits(['aaa'])}>
        prune
      </button>
      <input aria-label="text entry" />
    </div>
  )
}

const ordered = ['aaa', 'bbb', 'ccc']

function renderProbe() {
  return render(
    <DetailSelectionProvider>
      <Probe />
    </DetailSelectionProvider>
  )
}

describe('detail selection store', () => {
  it('starts with no explicit selection so the detail pane can fall back to HEAD', () => {
    renderProbe()

    expect(screen.getByTestId('kind')).toHaveTextContent('head')
  })

  it('records the working copy when the working-copy row is picked', () => {
    renderProbe()

    fireEvent.click(screen.getByRole('button', { name: 'pick working copy' }))

    expect(screen.getByTestId('kind')).toHaveTextContent('working-copy')
  })

  it('accumulates commits through the multi-select algebra', () => {
    renderProbe()

    fireEvent.click(screen.getByRole('button', { name: 'pick bbb' }))
    expect(screen.getByTestId('shas')).toHaveTextContent('bbb')

    fireEvent.click(screen.getByRole('button', { name: 'add ccc' }))

    expect(screen.getByTestId('kind')).toHaveTextContent('commits')
    expect(screen.getByTestId('shas')).toHaveTextContent('bbb,ccc')
  })

  it('drops commits that are no longer in the timeline', () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'pick bbb' }))

    fireEvent.click(screen.getByRole('button', { name: 'prune' }))

    expect(screen.getByTestId('kind')).toHaveTextContent('head')
    expect(screen.getByTestId('shas')).toHaveTextContent('')
  })

  it('falls back to HEAD when Escape is pressed outside a text entry', () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'pick bbb' }))

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    expect(screen.getByTestId('kind')).toHaveTextContent('head')
  })

  it('leaves the selection alone when Escape comes from a text entry', () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'pick bbb' }))

    act(() => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'text entry' }), { key: 'Escape' })
    })

    expect(screen.getByTestId('kind')).toHaveTextContent('commits')
  })
})
