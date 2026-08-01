import {
  LIST_PANE_DEFAULT_WIDTH,
  LIST_PANE_MAX_WIDTH,
  LIST_PANE_MIN_WIDTH
} from '@shared/list-layout'
import { describe, expect, it } from 'vitest'
import { readListPaneWidth, writeListPaneWidth } from '../list-pane-widths'

describe('readListPaneWidth', () => {
  it('returns the default when the repo has no persisted width', () => {
    expect(readListPaneWidth({}, '/repo/a')).toBe(LIST_PANE_DEFAULT_WIDTH)
  })

  it('returns the persisted width for that repo path', () => {
    expect(readListPaneWidth({ '/repo/a': 520, '/repo/b': 640 }, '/repo/a')).toBe(520)
  })

  it('clamps persisted widths that fall outside the bounds', () => {
    expect(readListPaneWidth({ '/repo/a': 10 }, '/repo/a')).toBe(LIST_PANE_MIN_WIDTH)
    expect(readListPaneWidth({ '/repo/a': 4000 }, '/repo/a')).toBe(LIST_PANE_MAX_WIDTH)
  })

  it('falls back to the default when the persisted value is not a usable number', () => {
    const corrupted = {
      '/repo/a': 'wide',
      '/repo/b': null,
      '/repo/c': Number.NaN
    } as unknown as Record<string, number>
    expect(readListPaneWidth(corrupted, '/repo/a')).toBe(LIST_PANE_DEFAULT_WIDTH)
    expect(readListPaneWidth(corrupted, '/repo/b')).toBe(LIST_PANE_DEFAULT_WIDTH)
    expect(readListPaneWidth(corrupted, '/repo/c')).toBe(LIST_PANE_DEFAULT_WIDTH)
  })
})

describe('writeListPaneWidth', () => {
  it('stores the clamped width under the repo path', () => {
    expect(writeListPaneWidth({}, '/repo/a', 5000)).toEqual({ '/repo/a': LIST_PANE_MAX_WIDTH })
    expect(writeListPaneWidth({}, '/repo/a', 520)).toEqual({ '/repo/a': 520 })
  })

  it('leaves other repos untouched and does not mutate the input', () => {
    const existing = { '/repo/a': 520, '/repo/b': 640 }
    const next = writeListPaneWidth(existing, '/repo/a', 700)

    expect(next).toEqual({ '/repo/a': 700, '/repo/b': 640 })
    expect(existing).toEqual({ '/repo/a': 520, '/repo/b': 640 })
  })

  it('drops entries that are no longer usable numbers while writing', () => {
    const corrupted = { '/repo/a': 'wide' } as unknown as Record<string, number>
    expect(writeListPaneWidth(corrupted, '/repo/b', 520)).toEqual({ '/repo/b': 520 })
  })
})
