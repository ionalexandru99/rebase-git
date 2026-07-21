import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawnGit } from './spawn'

const AMEND_INDEX_PREFIX = 'rebase-amend-index-'

export const amendIndexPath = (gitDir: string): string =>
  path.join(gitDir, `${AMEND_INDEX_PREFIX}${process.pid}`)

async function runIndexGit(repoPath: string, args: string[]): Promise<string> {
  const { code, stdout, stderr } = await spawnGit(['-C', repoPath, ...args])
  if (code !== 0) {
    throw new Error(stderr.trim() || `git ${args[0]} exited with code ${code}`)
  }
  return stdout
}

export async function synchronizeIndexToCommit(repoPath: string, commit: string): Promise<void> {
  await runIndexGit(repoPath, ['read-tree', commit])
}

export async function readIndexTree(repoPath: string): Promise<string> {
  return (await runIndexGit(repoPath, ['write-tree'])).trim()
}

export async function removeAbandonedAmendIndexes(gitDir: string): Promise<void> {
  const entries = await readdir(gitDir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(AMEND_INDEX_PREFIX))
      .map((entry) => rm(path.join(gitDir, entry.name), { force: true }))
  )
}
