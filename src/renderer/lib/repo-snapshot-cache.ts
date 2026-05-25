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
const snapshots = new Map<string, RepoSnapshot>()

export function readSnapshot(repoPath: string): RepoSnapshot | undefined {
  return snapshots.get(repoPath)
}

export function writeSnapshot(repoPath: string, patch: RepoSnapshot): void {
  const previous = snapshots.get(repoPath) ?? {}
  snapshots.delete(repoPath)
  snapshots.set(repoPath, { ...previous, ...patch })
  while (snapshots.size > MAX_ENTRIES) {
    const oldest = snapshots.keys().next().value
    if (oldest === undefined) {
      break
    }
    snapshots.delete(oldest)
  }
}

export function evictSnapshot(repoPath: string): void {
  snapshots.delete(repoPath)
}

export function clearAllSnapshots(): void {
  snapshots.clear()
}

export function hasCachedData(snapshot: RepoSnapshot | undefined): boolean {
  return (
    snapshot !== undefined &&
    (snapshot.status !== undefined || snapshot.branches !== undefined || snapshot.log !== undefined)
  )
}
