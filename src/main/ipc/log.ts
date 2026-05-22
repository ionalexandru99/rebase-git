import { encodeOrThrow } from '@shared/codec'
import { Channel, LogResponse } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { lookupGit } from '../git/instances'
import { GRAPH_LOG_FLAGS, GRAPH_LOG_FORMAT, serializeLog } from '../git/serialize'
import { gitInstances } from '../state'

export function register(): void {
  ipcMain.handle(Channel.getLog, async (_, repoPath: string, maxCount?: number) => {
    const git = lookupGit(gitInstances, repoPath)
    if (!git) return encodeOrThrow(LogResponse, { _tag: 'RepoNotOpen' })
    try {
      const logOptions: Record<string, unknown> = {
        format: GRAPH_LOG_FORMAT,
        ...GRAPH_LOG_FLAGS
      }
      if (typeof maxCount === 'number' && maxCount > 0) logOptions.maxCount = maxCount
      const log = await git.log(logOptions)
      return encodeOrThrow(LogResponse, { _tag: 'Ok', log: serializeLog(log) })
    } catch (error) {
      return encodeOrThrow(LogResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
}
