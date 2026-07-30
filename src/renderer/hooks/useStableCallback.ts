import { useCallback } from 'react'
import { useLatestRef } from './useLatestRef'

export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result
): (...args: Args) => Result {
  const latest = useLatestRef(callback)
  return useCallback((...args: Args) => latest.current(...args), [])
}
