import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useGraphMetrics } from '@/hooks/useGraphMetrics'
import { graphMetricsFor } from '@/lib/git-graph/metrics'

afterEach(() => {
  document.documentElement.style.fontSize = ''
})

describe('useGraphMetrics', () => {
  it('reports the metrics for the current root font size', () => {
    document.documentElement.style.fontSize = '16px'

    const { result } = renderHook(() => useGraphMetrics())

    expect(result.current).toBe(graphMetricsFor(16))
  })

  it('picks up a root font size change on resize', () => {
    document.documentElement.style.fontSize = '16px'
    const { result } = renderHook(() => useGraphMetrics())
    const before = result.current

    document.documentElement.style.fontSize = '20px'
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current.rootPx).toBe(20)
    expect(result.current.rowHeight).toBeGreaterThan(before.rowHeight)
  })

  it('keeps the same metrics object when the root font size is unchanged', () => {
    document.documentElement.style.fontSize = '16px'
    const { result } = renderHook(() => useGraphMetrics())
    const before = result.current

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current).toBe(before)
  })
})
