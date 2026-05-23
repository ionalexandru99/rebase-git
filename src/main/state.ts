import type { ChildProcess } from 'node:child_process'
import { Effect } from 'effect'
import type { SimpleGit } from 'simple-git'

export const gitInstances = new Map<string, SimpleGit>()
export const activeFetches = new Map<string, ChildProcess>()
const fetchSemaphores = new Map<string, Effect.Semaphore>()

export function fetchSemaphoreFor(repoPath: string): Effect.Semaphore {
  let semaphore = fetchSemaphores.get(repoPath)
  if (!semaphore) {
    semaphore = Effect.unsafeMakeSemaphore(1)
    fetchSemaphores.set(repoPath, semaphore)
  }
  return semaphore
}
