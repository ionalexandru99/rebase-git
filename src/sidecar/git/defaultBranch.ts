import type { SimpleGit } from 'simple-git'

export async function resolveDefaultBranch(
  git: SimpleGit,
  currentLocal: string | undefined
): Promise<string | undefined> {
  try {
    const out = await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    const name = out.trim()
    if (name.startsWith('origin/')) return name.slice('origin/'.length)
  } catch {}
  return currentLocal && currentLocal !== 'HEAD' ? currentLocal : undefined
}
