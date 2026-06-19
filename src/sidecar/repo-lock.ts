import { Duration, Effect } from 'effect'
import { GitError } from './git-errors'

const repoSemaphores = new Map<string, Effect.Semaphore>()
const heldLocks = new Map<string, number>()

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
  } else {
    heldLocks.set(repoPath, next)
  }
}

interface RepoLockOptions {
  // Local git ops get a watchdog timeout so a hung process can't hold the lock forever; pass null
  // for network ops (pull/push) that legitimately run long.
  timeoutMs?: number | null
}

// Serialize Git work per repo on an Effect Semaphore. The permit is released on every exit path —
// success, failure, timeout, and interruption — because withPermits is built on `ensuring`, so a
// hung or cancelled op can never strand the lock.
//
// The watchdog timeout frees the lock if a local git op wedges (e.g. blocked on an externally-held
// `.git/index.lock`); the wedged child may still be running when the next op proceeds, but git's own
// `index.lock` serializes index mutation at the OS level, so the worst case is a transient GitError
// for that next op rather than a corrupt index. Network ops pass `timeoutMs: null` (they run long).
export function withRepoLock<A, E, R>(
  repoPath: string,
  work: Effect.Effect<A, E, R>,
  options?: RepoLockOptions
): Effect.Effect<A, E | GitError, R> {
  const timeoutMs = options?.timeoutMs === undefined ? DEFAULT_LOCK_TIMEOUT_MS : options.timeoutMs
  const guarded =
    timeoutMs === null
      ? work
      : Effect.timeoutFail(work, {
          duration: Duration.millis(timeoutMs),
          onTimeout: () => new GitError({ message: 'git operation timed out' })
        })
  // markHeld/unmarkHeld run inside the permit so repoLockCount reflects only held locks; the
  // release runs on every exit path (acquireUseRelease finalizers are uninterruptible).
  const tracked = Effect.acquireUseRelease(
    Effect.sync(() => markHeld(repoPath)),
    () => guarded,
    () => Effect.sync(() => unmarkHeld(repoPath))
  )
  return Effect.suspend(() => semaphoreFor(repoPath).withPermits(1)(tracked))
}

export function repoLockCount(): number {
  return heldLocks.size
}

// Drop a repo's cached semaphore on close so the map doesn't grow unbounded over the process
// lifetime. Skip while a lock is held: deleting a live semaphore would hand a concurrent acquirer a
// fresh one and break mutual exclusion for the in-flight op.
export function releaseRepoSemaphore(repoPath: string): boolean {
  if (heldLocks.has(repoPath)) {
    return false
  }
  return repoSemaphores.delete(repoPath)
}
