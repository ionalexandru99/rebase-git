import { afterEach, describe, expect, it } from 'vitest'
import { graphMetricsFor, readGraphMetrics } from '@/lib/git-graph/metrics'

afterEach(() => {
  document.documentElement.style.fontSize = ''
})

describe('graphMetricsFor', () => {
  it('derives every dimension from the root font size', () => {
    const base = graphMetricsFor(16)
    const doubled = graphMetricsFor(32)

    expect(doubled.rowHeight).toBe(base.rowHeight * 2)
    expect(doubled.columnWidth).toBe(base.columnWidth * 2)
    expect(doubled.railPadding).toBe(base.railPadding * 2)
    expect(doubled.dotRadius).toBe(base.dotRadius * 2)
    expect(doubled.mergeDotRadius).toBe(base.mergeDotRadius * 2)
  })

  it('keeps row height and column width whole so rows land on device pixels', () => {
    const metrics = graphMetricsFor(15.7)

    expect(Number.isInteger(metrics.rowHeight)).toBe(true)
    expect(Number.isInteger(metrics.columnWidth)).toBe(true)
    expect(Number.isInteger(metrics.railPadding)).toBe(true)
  })

  it('returns the same object for the same root size so it can be a dependency', () => {
    expect(graphMetricsFor(16)).toBe(graphMetricsFor(16))
    expect(graphMetricsFor(16)).not.toBe(graphMetricsFor(20))
  })
})

describe('readGraphMetrics', () => {
  it('reuses one object until the root font size actually changes', () => {
    document.documentElement.style.fontSize = '16px'
    const first = readGraphMetrics()

    expect(readGraphMetrics()).toBe(first)

    document.documentElement.style.fontSize = '20px'
    const larger = readGraphMetrics()

    expect(larger).not.toBe(first)
    expect(larger.rowHeight).toBeGreaterThan(first.rowHeight)
  })

  it('falls back to a sane root size when the document reports nothing usable', () => {
    document.documentElement.style.fontSize = 'not-a-size'

    expect(readGraphMetrics().rowHeight).toBe(graphMetricsFor(16).rowHeight)
  })
})
