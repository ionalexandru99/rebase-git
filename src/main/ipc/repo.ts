import { parseOrThrow } from '@shared/codec'
import { normalizeRepoPath, tabResourceKey } from '@shared/repo-path'
import { CloseRepo, OpenRepo } from '@shared/rpc'
import { rpcResultSchema } from '@shared/rpc-result'
import { Channel } from '@shared/schemas/ipc'
import { ManagedRuntime } from 'effect'
import { ipcMain } from 'electron'
import { RepoLifecycleQueue, RepoLifecycleQueueLive } from '../repo/lifecycle-queue'
import { startWatching, stopWatching } from '../repo/watcher'
import { sidecarRpcCall } from '../sidecar/process'
import { addRecentRepo } from '../store/index'

const lifecycleRuntime = ManagedRuntime.make(RepoLifecycleQueueLive)
const lifecycleQueue = lifecycleRuntime.runPromise(RepoLifecycleQueue)

function openLifecycle<T>(
  key: string,
  owner: number,
  task: () => Promise<T>,
  retainsOwnership: (result: T) => boolean
): Promise<T> {
  return lifecycleQueue.then((queue) => queue.open(key, owner, task, retainsOwnership))
}

function releaseLifecycle<T>(key: string, owner: number, task: () => Promise<T>) {
  return lifecycleQueue.then((queue) => queue.release(key, owner, task))
}

export function register(): void {
  ipcMain.handle(Channel.openRepo, async (event, repoPath: string, owner: number) => {
    const key = tabResourceKey(event.sender.id, normalizeRepoPath(repoPath))
    return openLifecycle(
      key,
      owner,
      async () => {
        const response = parseOrThrow(
          rpcResultSchema(OpenRepo),
          await sidecarRpcCall(OpenRepo._tag, { repoPath })
        )
        if (response._tag === 'Ok') {
          addRecentRepo(response.result.path)
          startWatching(response.result.path, event.sender, {
            gitDir: response.result.gitDir,
            commonDir: response.result.commonDir
          })
        }
        return response
      },
      (response) => response._tag === 'Ok'
    )
  })

  ipcMain.handle(Channel.closeRepo, async (event, repoPath: string, owner: number) => {
    const normalizedPath = normalizeRepoPath(repoPath)
    const key = tabResourceKey(event.sender.id, normalizedPath)
    await releaseLifecycle(key, owner, async () => {
      try {
        await sidecarRpcCall(CloseRepo._tag, { repoPath })
      } finally {
        await stopWatching(normalizedPath, event.sender.id)
      }
    })
  })

  ipcMain.handle(Channel.disownRepo, async (event, repoPath: string, owner: number) => {
    const key = tabResourceKey(event.sender.id, normalizeRepoPath(repoPath))
    await lifecycleQueue.then((queue) => queue.disown(key, owner))
  })
}

export function finalizeRepoLifecycleQueue(): Promise<void> {
  return lifecycleRuntime.dispose()
}
