import { useCallback } from 'react'
import { useLatestRef } from './useLatestRef'

// A callback identity that never changes while still calling the newest closure. Handed to memoised
// list rows, where a fresh function per render would defeat the memo for every visible row.
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result
): (...args: Args) => Result {
  const latest = useLatestRef(callback)
  return useCallback((...args: Args) => latest.current(...args), [])
}
