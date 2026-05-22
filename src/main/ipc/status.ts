import { encodeOrThrow } from '@shared/codec'
import {
  Channel,
  CommitResponse,
  StageResponse,
  StatusResponse,
  UnstageResponse
} from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { lookupGit } from '../git/instances'
import { serializeStatus } from '../git/serialize'
import { gitInstances } from '../state'

export function register(): void {
  ipcMain.handle(Channel.getStatus, async (_, repoPath: string) => {
    const git = lookupGit(gitInstances, repoPath)
    if (!git) return encodeOrThrow(StatusResponse, { _tag: 'RepoNotOpen' })
    try {
      const status = await git.status()
      return encodeOrThrow(StatusResponse, { _tag: 'Ok', status: serializeStatus(status) })
    } catch (error) {
      return encodeOrThrow(StatusResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })

  ipcMain.handle(Channel.stageFile, async (_, repoPath: string, file: string) => {
    const git = lookupGit(gitInstances, repoPath)
    if (!git) return encodeOrThrow(StageResponse, { _tag: 'RepoNotOpen' })
    try {
      await git.add(file)
      return encodeOrThrow(StageResponse, { _tag: 'Ok' })
    } catch (error) {
      return encodeOrThrow(StageResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })

  ipcMain.handle(Channel.unstageFile, async (_, repoPath: string, file: string) => {
    const git = lookupGit(gitInstances, repoPath)
    if (!git) return encodeOrThrow(UnstageResponse, { _tag: 'RepoNotOpen' })
    try {
      await git.reset(['HEAD', file])
      return encodeOrThrow(UnstageResponse, { _tag: 'Ok' })
    } catch (error) {
      return encodeOrThrow(UnstageResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })

  ipcMain.handle(Channel.commit, async (_, repoPath: string, message: string) => {
    const git = lookupGit(gitInstances, repoPath)
    if (!git) return encodeOrThrow(CommitResponse, { _tag: 'RepoNotOpen' })
    try {
      const result = await git.commit(message)
      return encodeOrThrow(CommitResponse, {
        _tag: 'Ok',
        result: {
          commit: result.commit,
          branch: result.branch,
          summary: { ...result.summary }
        }
      })
    } catch (error) {
      return encodeOrThrow(CommitResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
}
