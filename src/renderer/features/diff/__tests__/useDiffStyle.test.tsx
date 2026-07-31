import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDiffStyle } from '@/features/diff/useDiffStyle'

beforeEach(() => {
  localStorage.clear()
})

describe('useDiffStyle', () => {
  it('defaults to unified when nothing is stored', () => {
    const { result } = renderHook(() => useDiffStyle())

    expect(result.current[0]).toBe('unified')
  })

  it('updates the style and persists it', () => {
    const { result } = renderHook(() => useDiffStyle())

    act(() => {
      result.current[1]('split')
    })

    expect(result.current[0]).toBe('split')
    expect(localStorage.getItem('rebase:diff-style')).toBe('split')
  })

  it('reads a persisted split preference back on mount', () => {
    localStorage.setItem('rebase:diff-style', 'split')

    const { result } = renderHook(() => useDiffStyle())

    expect(result.current[0]).toBe('split')
  })

  it('falls back to unified for an unknown stored value', () => {
    localStorage.setItem('rebase:diff-style', 'sideways')

    const { result } = renderHook(() => useDiffStyle())

    expect(result.current[0]).toBe('unified')
  })
})
