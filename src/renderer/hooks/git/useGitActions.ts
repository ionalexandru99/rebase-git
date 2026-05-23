import { Deferred, Effect, Fiber } from 'effect'
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
import {
  commitProgram,
  openLifecycle,
  runFetchAndRefresh,
  stageProgram,
  unstageProgram
} from '@/lib/git-effect/program'
import type { GitSetters } from '@/lib/git-effect/types'

export interface UseGitActionsArgs {
  setters: GitSetters
  repoPathRef: MutableRefObject<string | null>
  reset: () => void
  bumpFetchResetKey: () => void
}

export function useGitActions({
  setters,
  repoPathRef,
  reset,
  bumpFetchResetKey
}: UseGitActionsArgs) {
  const openFiberRef = useRef<Fiber.RuntimeFiber<void, never> | null>(null)

  const interruptOpen = useCallback(() => {
    const fiber = openFiberRef.current
    openFiberRef.current = null
    if (fiber) Effect.runFork(Fiber.interrupt(fiber))
  }, [])

  const openRepo = useCallback(
    async (path: string) => {
      interruptOpen()
      const ready = await Effect.runPromise(Deferred.make<void>())
      const fiber = Effect.runFork(openLifecycle(path, setters, ready))
      openFiberRef.current = fiber
      await Effect.runPromise(Deferred.await(ready))
    },
    [interruptOpen, setters]
  )

  const closeRepo = useCallback(async () => {
    interruptOpen()
    const path = repoPathRef.current
    if (path) {
      try {
        await window.electronAPI.cancelLogStream(path).catch(() => {})
        await window.electronAPI.closeRepo(path)
      } catch {}
    }
    reset()
  }, [interruptOpen, repoPathRef, reset])

  useEffect(() => {
    return () => {
      const path = repoPathRef.current
      interruptOpen()
      if (!path) return
      Promise.resolve(window.electronAPI.cancelLogStream(path)).catch(() => {})
      Promise.resolve(window.electronAPI.closeRepo(path)).catch(() => {})
    }
  }, [interruptOpen, repoPathRef])

  const stageFile = useCallback(
    async (file: string) => {
      const path = repoPathRef.current
      if (!path) return
      await Effect.runPromise(stageProgram(path, file, setters))
    },
    [setters, repoPathRef]
  )

  const unstageFile = useCallback(
    async (file: string) => {
      const path = repoPathRef.current
      if (!path) return
      await Effect.runPromise(unstageProgram(path, file, setters))
    },
    [setters, repoPathRef]
  )

  const commit = useCallback(
    async (message: string): Promise<boolean> => {
      const path = repoPathRef.current
      if (!path) return false
      return Effect.runPromise(commitProgram(path, message, setters))
    },
    [setters, repoPathRef]
  )

  const fetchNow = useCallback(async () => {
    const path = repoPathRef.current
    if (!path) return
    bumpFetchResetKey()
    await Effect.runPromise(runFetchAndRefresh(path, setters))
  }, [setters, repoPathRef, bumpFetchResetKey])

  return { openRepo, closeRepo, stageFile, unstageFile, commit, fetchNow }
}
