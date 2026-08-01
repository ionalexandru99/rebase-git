import { describe, expect, it } from 'vitest'
import {
  type CommitSelection,
  EMPTY_COMMIT_SELECTION,
  pruneCommitSelection,
  selectCommit
} from '../commit-selection'

const rows = ['c5', 'c4', 'c3', 'c2', 'c1']

const plain = { toggle: false, range: false }
const toggle = { toggle: true, range: false }
const range = { toggle: false, range: true }
const both = { toggle: true, range: true }

const select = (
  current: CommitSelection,
  sha: string,
  modifiers: { toggle: boolean; range: boolean }
) => selectCommit(current, sha, modifiers, rows)

describe('selectCommit — plain click', () => {
  it('selects the clicked commit and anchors on it', () => {
    expect(select(EMPTY_COMMIT_SELECTION, 'c3', plain)).toEqual({ shas: ['c3'], anchor: 'c3' })
  })

  it('replaces an existing multi-selection', () => {
    const current = { shas: ['c5', 'c4', 'c3'], anchor: 'c5' }

    expect(select(current, 'c1', plain)).toEqual({ shas: ['c1'], anchor: 'c1' })
  })

  it('keeps the already-selected commit selected when clicked again', () => {
    expect(select({ shas: ['c2'], anchor: 'c2' }, 'c2', plain)).toEqual({
      shas: ['c2'],
      anchor: 'c2'
    })
  })
})

describe('selectCommit — toggle click', () => {
  it('adds a commit to the selection and moves the anchor to it', () => {
    const current = { shas: ['c4'], anchor: 'c4' }

    expect(select(current, 'c2', toggle)).toEqual({ shas: ['c4', 'c2'], anchor: 'c2' })
  })

  it('removes an already-selected commit', () => {
    const current = { shas: ['c4', 'c2'], anchor: 'c2' }

    expect(select(current, 'c4', toggle)).toEqual({ shas: ['c2'], anchor: 'c4' })
  })

  it('keeps the selection in timeline order however it was assembled', () => {
    let selection = select(EMPTY_COMMIT_SELECTION, 'c1', toggle)
    selection = select(selection, 'c4', toggle)
    selection = select(selection, 'c3', toggle)

    expect(selection.shas).toEqual(['c4', 'c3', 'c1'])
  })

  it('can empty the selection entirely', () => {
    expect(select({ shas: ['c3'], anchor: 'c3' }, 'c3', toggle)).toEqual({
      shas: [],
      anchor: 'c3'
    })
  })
})

describe('selectCommit — range click', () => {
  it('selects the contiguous run from the anchor down to the clicked commit', () => {
    const current = { shas: ['c4'], anchor: 'c4' }

    expect(select(current, 'c2', range)).toEqual({ shas: ['c4', 'c3', 'c2'], anchor: 'c4' })
  })

  it('selects the same run when the click is above the anchor', () => {
    const current = { shas: ['c2'], anchor: 'c2' }

    expect(select(current, 'c4', range)).toEqual({ shas: ['c4', 'c3', 'c2'], anchor: 'c2' })
  })

  it('leaves the anchor put so successive shift-clicks re-extend from it', () => {
    const first = select({ shas: ['c5'], anchor: 'c5' }, 'c3', range)
    const second = select(first, 'c2', range)

    expect(second).toEqual({ shas: ['c5', 'c4', 'c3', 'c2'], anchor: 'c5' })
    expect(select(second, 'c4', range).shas).toEqual(['c5', 'c4'])
  })

  it('replaces the selection rather than accumulating ranges', () => {
    const current = { shas: ['c5', 'c1'], anchor: 'c5' }

    expect(select(current, 'c4', range).shas).toEqual(['c5', 'c4'])
  })

  it('falls back to a plain selection when there is no anchor yet', () => {
    expect(select(EMPTY_COMMIT_SELECTION, 'c3', range)).toEqual({ shas: ['c3'], anchor: 'c3' })
  })

  it('falls back to a plain selection when the anchor is no longer on screen', () => {
    const current = { shas: ['gone'], anchor: 'gone' }

    expect(select(current, 'c3', range)).toEqual({ shas: ['c3'], anchor: 'c3' })
  })

  it('unions the range with the existing selection when toggle is held too', () => {
    const current = { shas: ['c1'], anchor: 'c4' }

    expect(select(current, 'c3', both)).toEqual({ shas: ['c4', 'c3', 'c1'], anchor: 'c4' })
  })
})

describe('pruneCommitSelection', () => {
  it('drops commits that are no longer displayed', () => {
    const current = { shas: ['c5', 'c3', 'c1'], anchor: 'c3' }

    expect(pruneCommitSelection(current, ['c5', 'c1'])).toEqual({
      shas: ['c5', 'c1'],
      anchor: null
    })
  })

  it('keeps the anchor when it survives', () => {
    const current = { shas: ['c5', 'c3'], anchor: 'c5' }

    expect(pruneCommitSelection(current, ['c5'])).toEqual({ shas: ['c5'], anchor: 'c5' })
  })

  it('returns the same object when nothing changed, so React can skip the update', () => {
    const current = { shas: ['c5', 'c4'], anchor: 'c5' }

    expect(pruneCommitSelection(current, rows)).toBe(current)
  })
})
