import { encodeOrThrow } from '@shared/codec'
import { BranchesResponse, Channel, OpenRepoResponse } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { resolveDefaultBranch } from '../git/defaultBranch'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from '../git/instances'
import { serializeBranches, serializeRemotes } from '../git/serialize'
import { startWatching, stopWatching } from '../repoWatcher'
import { activeFetches, gitInstances } from '../state'
import { addRecentRepo } from '../store'

export function register(): void {
  ipcMain.handle(Channel.openRepo, async (event, repoPath: string) => {
    const key = normalizeRepoPath(repoPath)
    try {
      const git = getOrCreateGit(gitInstances, key)
      const isRepo = await git.checkIsRepo()

      if (!isRepo) {
        gitInstances.delete(key)
        return encodeOrThrow(OpenRepoResponse, { _tag: 'NotARepo' })
      }

      addRecentRepo(key)

      const remotes = await git.getRemotes(true)
      const defaultBranch = await resolveDefaultBranch(git, undefined)

      startWatching(key, event.sender)

      return encodeOrThrow(OpenRepoResponse, {
        _tag: 'Ok',
        result: {
          remotes: serializeRemotes(remotes),
          defaultBranch,
          path: key
        }
      })
    } catch (error) {
      return encodeOrThrow(OpenRepoResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })

  ipcMain.handle(Channel.closeRepo, async (_, repoPath: string) => {
    const key = normalizeRepoPath(repoPath)
    gitInstances.delete(key)
    const proc = activeFetches.get(key)
    if (proc && !proc.killed) proc.kill()
    activeFetches.delete(key)
    await stopWatching(key)
  })

  ipcMain.handle(Channel.getBranches, async (_, repoPath: string) => {
    const git = lookupGit(gitInstances, repoPath)
    if (!git) return encodeOrThrow(BranchesResponse, { _tag: 'RepoNotOpen' })
    try {
      const [branches, tags] = await Promise.all([git.branch(['-a']), git.tags()])
      return encodeOrThrow(BranchesResponse, {
        _tag: 'Ok',
        branches: serializeBranches(branches, tags)
      })
    } catch (error) {
      return encodeOrThrow(BranchesResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
}
