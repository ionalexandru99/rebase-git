import { Effect, SubscriptionRef } from 'effect'
import type { GitBranches, GitLog, GitStatus } from '@/types'

export interface RepoSnapshot {
  status?: GitStatus
  branches?: GitBranches
  log?: GitLog
  currentBranch?: string
  remotes?: Record<string, string>
  defaultBranch?: string
}

const MAX_ENTRIES = 8

const store = Effect.runSync(SubscriptionRef.make(new Map<string, RepoSnapshot>()))

export const snapshotChanges = store.changes

export const readSnapshot = (repoPath: string): Effect.Effect<RepoSnapshot | undefined> =>
  Effect.map(SubscriptionRef.get(store), (snapshots) => snapshots.get(repoPath))

export const writeSnapshot = (repoPath: string, patch: RepoSnapshot): Effect.Effect<void> =>
  SubscriptionRef.update(store, (snapshots) => {
    const next = new Map(snapshots)
    const previous = next.get(repoPath) ?? {}
    next.delete(repoPath)
    next.set(repoPath, { ...previous, ...patch })
    while (next.size > MAX_ENTRIES) {
      const oldest = next.keys().next().value
      if (oldest === undefined) break
      next.delete(oldest)
    }
    return next
  })

export const evictSnapshot = (repoPath: string): Effect.Effect<void> =>
  SubscriptionRef.update(store, (snapshots) => {
    if (!snapshots.has(repoPath)) return snapshots
    const next = new Map(snapshots)
    next.delete(repoPath)
    return next
  })

export const clearAllSnapshots = (): void => {
  Effect.runSync(SubscriptionRef.set(store, new Map()))
}

export const readSnapshotSync = (repoPath: string): RepoSnapshot | undefined =>
  Effect.runSync(readSnapshot(repoPath))

export const writeSnapshotSync = (repoPath: string, patch: RepoSnapshot): void =>
  Effect.runSync(writeSnapshot(repoPath, patch))

export const hasCachedData = (snapshot: RepoSnapshot | undefined): boolean =>
  snapshot !== undefined &&
  (snapshot.status !== undefined || snapshot.branches !== undefined || snapshot.log !== undefined)
