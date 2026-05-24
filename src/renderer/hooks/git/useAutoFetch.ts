import { useEffect } from 'react'
import { runFetchAndRefresh } from '@/lib/git-effect/program'
import type { GitSetters } from '@/lib/git-effect/types'
import { runtime } from '@/lib/runtime'

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000

export function useAutoFetch(
  repoPath: string | null,
  setters: GitSetters,
  fetchResetKey: number
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetchResetKey is intentionally a trigger dep — bumping it restarts the auto-fetch interval after a manual fetch
  useEffect(() => {
    if (!repoPath) return
    const path = repoPath
    const handle = window.setInterval(() => {
      runtime.runFork(runFetchAndRefresh(path, setters))
    }, AUTO_FETCH_INTERVAL_MS)
    return () => window.clearInterval(handle)
  }, [repoPath, setters, fetchResetKey])
}
