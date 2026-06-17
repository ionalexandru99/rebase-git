import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createStore } from '@/lib/react-store-compat'

interface Sample {
  count: number
  nested: { value: number; items: number[] }
  other: { untouched: boolean }
}

const initial: Sample = {
  count: 0,
  nested: { value: 1, items: [1, 2, 3] },
  other: { untouched: true }
}

const renderStore = () => renderHook(() => createStore<Sample>({ ...initial }))

describe('createStore', () => {
  it('hands back a fresh state identity when a top-level field changes', () => {
    const { result } = renderStore()
    const [before] = result.current
    act(() => {
      result.current[1]('count', 1)
    })
    const [after] = result.current
    expect(after).not.toBe(before)
    expect(after.count).toBe(1)
  })

  it('keeps the same identity when a field is set to its current value', () => {
    const { result } = renderStore()
    const [before] = result.current
    act(() => {
      result.current[1]('count', 0)
    })
    expect(result.current[0]).toBe(before)
  })

  it('structurally shares untouched branches on a nested path update', () => {
    const { result } = renderStore()
    const [before] = result.current
    act(() => {
      result.current[1]('nested', 'value', 2)
    })
    const [after] = result.current
    expect(after).not.toBe(before)
    expect(after.nested).not.toBe(before.nested)
    expect(after.nested.value).toBe(2)
    expect(after.nested.items).toBe(before.nested.items)
    expect(after.other).toBe(before.other)
  })

  it('keeps identity when a nested path is set to an equal value', () => {
    const { result } = renderStore()
    const [before] = result.current
    act(() => {
      result.current[1]('nested', 'value', 1)
    })
    expect(result.current[0]).toBe(before)
  })

  it('merges a partial object patch, replacing only changed keys', () => {
    const { result } = renderStore()
    const [before] = result.current
    act(() => {
      result.current[1]({ count: 5 })
    })
    const [after] = result.current
    expect(after).not.toBe(before)
    expect(after.count).toBe(5)
    expect(after.nested).toBe(before.nested)
  })

  it('treats a no-op object patch as a stable-identity no-op', () => {
    const { result } = renderStore()
    const [before] = result.current
    act(() => {
      result.current[1]({ count: 0 })
    })
    expect(result.current[0]).toBe(before)
  })

  it('applies a functional updater against the live state', () => {
    const { result } = renderStore()
    act(() => {
      result.current[1]('count', (previous: number) => previous + 3)
    })
    expect(result.current[0].count).toBe(3)
  })
})
