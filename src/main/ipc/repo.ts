import { encodeOrThrow } from '@shared/codec'
import { BranchesResponse, Channel, CheckoutResponse, OpenRepoResponse } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { deriveLocalShortName } from '../git/checkout'
import { resolveDefaultBranch } from '../git/defaultBranch'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from '../git/instances'
import { serializeBranches, serializeRemotes } from '../git/serialize'
import { parseAheadBehind } from '../git/tracking'
import { startWatching, stopWatching } from '../repoWatcher'
import { activeFetches, gitInstances, releaseFetchSemaphore } from '../state'
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
    releaseFetchSemaphore(key)
    await stopWatching(key)
  })

  ipcMain.handle(Channel.getBranches, async (_, repoPath: string) => {
    const git = lookupGit(gitInstances, repoPath)
    if (!git) return encodeOrThrow(BranchesResponse, { _tag: 'RepoNotOpen' })
    try {
      const [branches, tags, trackingRaw] = await Promise.all([
        git.branch(['-a']),
        git.tags(),
        git.raw(['for-each-ref', 'refs/heads', '--format=%(refname:short)|%(upstream:track)'])
      ])
      const tracking = parseAheadBehind(trackingRaw)
      return encodeOrThrow(BranchesResponse, {
        _tag: 'Ok',
        branches: serializeBranches(branches, tags, tracking)
      })
    } catch (error) {
      return encodeOrThrow(BranchesResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })

  ipcMain.handle(
    Channel.checkoutRef,
    async (_, repoPath: string, refKind: 'local' | 'remote' | 'tag', fullPath: string) => {
      const git = lookupGit(gitInstances, repoPath)
      if (!git) return encodeOrThrow(CheckoutResponse, { _tag: 'RepoNotOpen' })
      try {
        let checkedOut: string
        if (refKind === 'remote') {
          const shortName = deriveLocalShortName(fullPath)
          const existing = await git.branch(['--list', shortName])
          if (existing.all.length > 0) {
            const upstreamRaw = await git.raw([
              'for-each-ref',
              `refs/heads/${shortName}`,
              '--format=%(upstream:short)'
            ])
            const upstream = upstreamRaw.trim()
            if (upstream !== fullPath) {
              return encodeOrThrow(CheckoutResponse, {
                _tag: 'GitError',
                message: `Local branch '${shortName}' tracks ${upstream || 'no remote'}, not ${fullPath}. Resolve manually.`
              })
            }
            await git.checkout([shortName])
          } else {
            await git.checkout(['--track', fullPath])
          }
          checkedOut = shortName
        } else {
          await git.checkout([fullPath])
          checkedOut = fullPath
        }
        return encodeOrThrow(CheckoutResponse, { _tag: 'Ok', checkedOut })
      } catch (error) {
        return encodeOrThrow(CheckoutResponse, {
          _tag: 'GitError',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  )
}
