import { fuzzyMatchSet } from '@/lib/fuzzy'
import { parseRefs } from '@/lib/git-graph/refs'
import type { GitLogEntry } from '@/types'

export function computeOnBranchSet(
  commits: GitLogEntry[],
  remoteNames: Set<string>,
  currentBranch: string | undefined
): Set<string> | null {
  let tip: string | undefined
  for (const commit of commits) {
    if (!commit.refs) {
      continue
    }
    const hasHead = commit.refs.split(',').some((part) => {
      const trimmed = part.trim()
      return trimmed === 'HEAD' || trimmed.startsWith('HEAD -> ')
    })
    if (hasHead) {
      tip = commit.hash
      break
    }
  }
  if (!tip && currentBranch) {
    for (const commit of commits) {
      if (!commit.refs) {
        continue
      }
      const parsed = parseRefs(commit.refs, remoteNames)
      if (parsed.some((ref) => ref.kind === 'branch' && ref.label === currentBranch)) {
        tip = commit.hash
        break
      }
    }
  }
  if (!tip) {
    return null
  }

  const byHash = new Map<string, GitLogEntry>()
  for (const commit of commits) {
    byHash.set(commit.hash, commit)
  }
  const reachable = new Set<string>()
  const stack = [tip]
  while (stack.length > 0) {
    const hash = stack.pop() as string
    if (reachable.has(hash)) {
      continue
    }
    reachable.add(hash)
    const commit = byHash.get(hash)
    if (!commit) {
      continue
    }
    for (const parent of commit.parents) {
      stack.push(parent)
    }
  }
  return reachable
}

export function computeVisibleSet(filter: string, commits: GitLogEntry[]): Set<string> | null {
  return fuzzyMatchSet(
    filter,
    commits,
    ['message', 'hash', 'author_name', 'refs'],
    (commit) => commit.hash
  )
}
