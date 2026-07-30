import { Duration, Effect } from 'effect'
import { GitError } from '../git/errors'
import { beginRepoOperation, cancelRepoOperation, endRepoOperation } from '../git/spawn'

const repoSemaphores = new Map<string, Effect.Semaphore>()
const heldLocks = new Map<string, number>()
const pendingReclaim = new Set<string>()

const DEFAULT_LOCK_TIMEOUT_MS = 120_000

function semaphoreFor(repoPath: string): Effect.Semaphore {
  let semaphore = repoSemaphores.get(repoPath)
  if (!semaphore) {
    semaphore = Effect.runSync(Effect.makeSemaphore(1))
    repoSemaphores.set(repoPath, semaphore)
  }
  return semaphore
}

function markHeld(repoPath: string): void {
  heldLocks.set(repoPath, (heldLocks.get(repoPath) ?? 0) + 1)
}

function unmarkHeld(repoPath: string): void {
  const next = (heldLocks.get(repoPath) ?? 0) - 1
  if (next <= 0) {
    heldLocks.delete(repoPath)
    if (pendingReclaim.delete(repoPath)) {
      repoSemaphores.delete(repoPath)
    }
  } else {
    heldLocks.set(repoPath, next)
  }
}

interface RepoLockOptions {
  timeoutMs?: number
}

export function withRepoLock<A, E, R>(
  repoPath: string,
  work: Effect.Effect<A, E, R>,
  options?: RepoLockOptions
): Effect.Effect<A, E | GitError, R> {
  const timeoutMs = options?.timeoutMs === undefined ? DEFAULT_LOCK_TIMEOUT_MS : options.timeoutMs
  const tracked = Effect.acquireUseRelease(
    Effect.sync(() => {
      markHeld(repoPath)
      return beginRepoOperation(repoPath)
    }),
    (operation) =>
      work.pipe(Effect.onInterrupt(() => Effect.promise(() => cancelRepoOperation(operation)))),
    (operation) =>
      Effect.promise(() => endRepoOperation(operation)).pipe(
        Effect.ensuring(Effect.sync(() => unmarkHeld(repoPath)))
      )
  )
  const locked = Effect.suspend(() => semaphoreFor(repoPath).withPermits(1)(tracked))
  return Effect.timeoutFail(locked, {
    duration: Duration.millis(timeoutMs),
    onTimeout: () => new GitError({ message: 'git operation timed out' })
  })
}

export function repoLockCount(): number {
  return heldLocks.size
}

export function repoSemaphoreSize(): number {
  return repoSemaphores.size
}

export function releaseRepoSemaphore(repoPath: string): boolean {
  if (heldLocks.has(repoPath)) {
    pendingReclaim.add(repoPath)
    return false
  }
  pendingReclaim.delete(repoPath)
  return repoSemaphores.delete(repoPath)
}

export function retainRepoSemaphore(repoPath: string): void {
  pendingReclaim.delete(repoPath)
}
