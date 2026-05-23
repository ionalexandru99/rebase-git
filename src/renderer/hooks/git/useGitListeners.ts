import { Effect } from 'effect'
import { type MutableRefObject, useEffect } from 'react'
import { silentRefreshRefs, silentRefreshStatus } from '@/lib/git-effect/program'
import type { GitSetters } from '@/lib/git-effect/types'

export function useGitListeners(setters: GitSetters, repoPathRef: MutableRefObject<string | null>) {
  useEffect(() => {
    const unsubLog = window.electronAPI.onLogChunk((chunk) => {
      if (chunk.repoPath !== repoPathRef.current) return
      if (chunk.commits.length > 0) setters.appendLogChunk(chunk.commits)
      if (chunk.error) setters.setError(chunk.error)
      if (chunk.done) setters.setLogLoading(false)
    })
    const unsubChanged = window.electronAPI.onRepoChanged((event) => {
      if (event.repoPath !== repoPathRef.current) return
      const refresh =
        event.kind === 'refs'
          ? silentRefreshRefs(event.repoPath, setters)
          : silentRefreshStatus(event.repoPath, setters)
      Effect.runFork(refresh)
    })
    return () => {
      unsubLog?.()
      unsubChanged?.()
    }
  }, [setters, repoPathRef])
}
