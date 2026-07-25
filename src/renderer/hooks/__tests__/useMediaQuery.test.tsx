import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from '../useMediaQuery'

interface MediaQueryController {
  mediaQuery: MediaQueryList
  setMatches: (matches: boolean) => void
}

function mediaQueryController(query: string, initialMatches: boolean): MediaQueryController {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mediaQuery = {
    get matches() {
      return matches
    },
    media: query,
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  } as MediaQueryList
  return {
    mediaQuery,
    setMatches(nextMatches) {
      matches = nextMatches
      const event = { matches: nextMatches, media: query } as MediaQueryListEvent
      for (const listener of listeners) {
        listener(event)
      }
    }
  }
}

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the initial match and updates when the media query changes', () => {
    const controller = mediaQueryController('(max-width: 899px)', true)
    vi.spyOn(window, 'matchMedia').mockReturnValue(controller.mediaQuery)

    const { result } = renderHook(() => useMediaQuery('(max-width: 899px)'))

    expect(result.current).toBe(true)
    expect(controller.mediaQuery.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    )

    act(() => controller.setMatches(false))

    expect(result.current).toBe(false)
  })

  it('moves its listener to a new query and cleans up on unmount', () => {
    const compact = mediaQueryController('(max-width: 899px)', false)
    const narrow = mediaQueryController('(max-width: 699px)', true)
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      return query === compact.mediaQuery.media ? compact.mediaQuery : narrow.mediaQuery
    })
    const { result, rerender, unmount } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: compact.mediaQuery.media }
    })

    rerender({ query: narrow.mediaQuery.media })

    expect(result.current).toBe(true)
    expect(matchMedia).toHaveBeenLastCalledWith(narrow.mediaQuery.media)
    expect(compact.mediaQuery.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    )
    expect(narrow.mediaQuery.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    unmount()
    expect(narrow.mediaQuery.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    )
  })

  it('falls back to false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)

    const { result } = renderHook(() => useMediaQuery('(max-width: 899px)'))

    expect(result.current).toBe(false)
    vi.unstubAllGlobals()
  })
})
