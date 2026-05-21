import type { ChildProcess } from 'node:child_process'

export function tryReserveFetch(
  active: Map<string, ChildProcess>,
  repoPath: string,
  proc: ChildProcess
): boolean {
  if (active.has(repoPath)) return false
  active.set(repoPath, proc)
  return true
}
