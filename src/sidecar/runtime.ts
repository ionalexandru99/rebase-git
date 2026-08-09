import type { Server } from 'node:http'
import type {
  SidecarCommand,
  SidecarMessage,
  SidecarStartMessage
} from '../common/legacy-sidecar-process'
import { applyNonInteractiveGitEnv } from './git/environment'
import { finalizeTrackedChildren, installTrackedChildShutdownHooks } from './git/spawn'
import { finalizeLogContinuations } from './operations/log-stream'
import { createSidecarServer } from './server/http'
import { finalizeFetchSemaphores } from './session/fetch-semaphore'

export interface SidecarParentPort {
  postMessage: (message: SidecarMessage) => void
  on: (event: 'message', listener: (event: { data: SidecarCommand }) => void) => void
}

export function startLegacySidecar(parentPort: SidecarParentPort): void {
  applyNonInteractiveGitEnv(process.env)
  const removeTrackedChildShutdownHooks = installTrackedChildShutdownHooks()
  let server: Server | undefined
  let shutdownPromise: Promise<void> | undefined

  function post(message: SidecarMessage): void {
    parentPort.postMessage(message)
  }

  function start(command: SidecarStartMessage): void {
    try {
      server = createSidecarServer(command.token)
      server.on('error', (error) => {
        post({ type: 'error', message: error.message })
        void shutdown(1)
      })
      server.listen(command.port, command.hostname, () => {
        post({ type: 'ready' })
      })
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      void shutdown(1)
    }
  }

  function closeServer(): Promise<void> {
    const current = server
    server = undefined
    if (!current) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      current.close(() => resolve())
      current.closeAllConnections()
    })
  }

  function shutdown(exitCode: number): Promise<void> {
    if (shutdownPromise) {
      return shutdownPromise
    }
    shutdownPromise = (async () => {
      const serverClosed = closeServer()
      removeTrackedChildShutdownHooks()
      await finalizeLogContinuations()
      await finalizeTrackedChildren()
      await finalizeFetchSemaphores()
      await serverClosed
      process.exit(exitCode)
    })()
    return shutdownPromise
  }

  parentPort.on('message', (event: { data: SidecarCommand }) => {
    const command = event.data
    if (command.type === 'start') {
      start(command)
    } else if (command.type === 'stop') {
      void shutdown(0)
    }
  })
}
