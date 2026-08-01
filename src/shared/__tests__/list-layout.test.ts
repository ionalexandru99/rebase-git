import { describe, expect, it } from 'vitest'
import {
  clampListPaneWidth,
  LIST_PANE_DEFAULT_WIDTH,
  LIST_PANE_MAX_WIDTH,
  LIST_PANE_MIN_WIDTH
} from '../list-layout'

describe('clampListPaneWidth', () => {
  it('exposes the bounds the divider is allowed to move between', () => {
    expect(LIST_PANE_MIN_WIDTH).toBe(300)
    expect(LIST_PANE_MAX_WIDTH).toBe(820)
    expect(LIST_PANE_DEFAULT_WIDTH).toBe(400)
  })

  it('keeps widths inside the bounds untouched', () => {
    expect(clampListPaneWidth(LIST_PANE_MIN_WIDTH)).toBe(LIST_PANE_MIN_WIDTH)
    expect(clampListPaneWidth(520)).toBe(520)
    expect(clampListPaneWidth(LIST_PANE_MAX_WIDTH)).toBe(LIST_PANE_MAX_WIDTH)
  })

  it('clamps widths outside the bounds', () => {
    expect(clampListPaneWidth(0)).toBe(LIST_PANE_MIN_WIDTH)
    expect(clampListPaneWidth(-40)).toBe(LIST_PANE_MIN_WIDTH)
    expect(clampListPaneWidth(5000)).toBe(LIST_PANE_MAX_WIDTH)
  })

  it('falls back to the default for non-finite widths', () => {
    expect(clampListPaneWidth(Number.NaN)).toBe(LIST_PANE_DEFAULT_WIDTH)
    expect(clampListPaneWidth(Number.POSITIVE_INFINITY)).toBe(LIST_PANE_DEFAULT_WIDTH)
    expect(clampListPaneWidth(Number.NEGATIVE_INFINITY)).toBe(LIST_PANE_DEFAULT_WIDTH)
  })
})
