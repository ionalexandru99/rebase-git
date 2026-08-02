import { literalPathspecs } from '../git/pathspec'

export interface DiscardPathGroups {
  tracked: string[]
  untracked: string[]
}

export function classifyDiscardPaths(
  files: readonly string[],
  statusOutput: string
): DiscardPathGroups {
  const untracked: string[] = []
  for (const entry of statusOutput.split('\0')) {
    if (entry.startsWith('??')) {
      untracked.push(entry.slice(3))
    }
  }
  const untrackedSet = new Set(untracked)
  return {
    tracked: files.filter((file) => !untrackedSet.has(file)),
    untracked
  }
}

export function trackedDiscardArgs(files: readonly string[], headExists: boolean): string[] {
  if (headExists) {
    return ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...literalPathspecs(files)]
  }
  return ['rm', '-rf', '--', ...literalPathspecs(files)]
}

export function untrackedDiscardArgs(files: readonly string[]): string[] {
  return ['clean', '-fd', '--', ...literalPathspecs(files)]
}

export function discardAllArgs(headExists: boolean): readonly [string[], string[]] {
  const tracked = headExists
    ? ['reset', '--hard', 'HEAD']
    : ['rm', '-rf', '--cached', '--ignore-unmatch', '--', '.']
  return [tracked, ['clean', '-fd']]
}
