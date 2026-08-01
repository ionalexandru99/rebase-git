import { describe, expect, it } from 'vitest'
import { computeGraphRailWidth } from '@/features/history/graph/canvas'
import { graphMetricsFor } from '@/features/history/graph/metrics'
import {
  historyRailWidth,
  reanchorScrollTop,
  singleLineGridTemplate
} from '@/features/history/row-layout'

const METRICS = graphMetricsFor(16)

describe('historyRailWidth', () => {
  it('grows with the lanes the layout actually uses', () => {
    expect(historyRailWidth(1, METRICS)).toBe(computeGraphRailWidth(1, METRICS))
    expect(historyRailWidth(4, METRICS)).toBe(computeGraphRailWidth(4, METRICS))
  })

  it('stops widening once the rail would eat the row', () => {
    expect(historyRailWidth(40, METRICS)).toBe(computeGraphRailWidth(8, METRICS))
  })

  it('keeps a one-lane rail for an empty or unmeasured layout', () => {
    expect(historyRailWidth(0, METRICS)).toBe(computeGraphRailWidth(1, METRICS))
    expect(historyRailWidth(Number.NaN, METRICS)).toBe(computeGraphRailWidth(1, METRICS))
  })
})

describe('reanchorScrollTop', () => {
  const anchor = (scrollTop: number, previousRowHeight: number, nextRowHeight: number) =>
    reanchorScrollTop({ scrollTop, previousRowHeight, nextRowHeight, paddingStart: 44 })

  it('keeps the topmost fully visible commit under the same edge', () => {
    expect(anchor(44 + 44 * 10, 44, 30)).toBe(44 + 30 * 10)
    expect(anchor(44 + 30 * 6, 30, 44)).toBe(44 + 44 * 6)
  })

  it('rounds a half-scrolled row down to the first commit fully in view', () => {
    expect(anchor(44 + 45, 44, 30)).toBe(44 + 30 * 2)
  })

  it('leaves the top of the list alone', () => {
    expect(anchor(0, 44, 30)).toBe(0)
    expect(anchor(20, 44, 30)).toBe(20)
  })

  it('does nothing when the pitch did not move', () => {
    expect(anchor(500, 30, 30)).toBe(500)
  })
})

describe('singleLineGridTemplate', () => {
  it('widens the author column only where the name is spelled out', () => {
    expect(singleLineGridTemplate('xwide')).not.toBe(singleLineGridTemplate('wide'))
  })
})
