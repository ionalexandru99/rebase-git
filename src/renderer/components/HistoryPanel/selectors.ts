import { parseRefs } from '@/lib/git-graph/refs'
import type { GitLogEntry } from '@/types'

export function computeOnBranchSet(
  commits: GitLogEntry[],
  remoteNames: Set<string>,
  currentBranch: string | undefined
): Set<string> | null {
  let tip: string | undefined
  for (const commit of commits) {
    if (!commit.refs) continue
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
      if (!commit.refs) continue
      const parsed = parseRefs(commit.refs, remoteNames)
      if (parsed.some((ref) => ref.kind === 'branch' && ref.label === currentBranch)) {
        tip = commit.hash
        break
      }
    }
  }
  if (!tip) return null

  const byHash = new Map<string, GitLogEntry>()
  for (const commit of commits) byHash.set(commit.hash, commit)
  const reachable = new Set<string>()
  const stack = [tip]
  while (stack.length > 0) {
    const hash = stack.pop() as string
    if (reachable.has(hash)) continue
    reachable.add(hash)
    const commit = byHash.get(hash)
    if (!commit) continue
    for (const parent of commit.parents) stack.push(parent)
  }
  return reachable
}

export function computeVisibleSet(filter: string, commits: GitLogEntry[]): Set<string> | null {
  const query = filter.trim().toLowerCase()
  if (!query) return null
  const matches = new Set<string>()
  for (const commit of commits) {
    if (
      commit.message.toLowerCase().includes(query) ||
      commit.hash.toLowerCase().includes(query) ||
      commit.author_name.toLowerCase().includes(query) ||
      commit.refs.toLowerCase().includes(query)
    ) {
      matches.add(commit.hash)
    }
  }
  return matches
}
