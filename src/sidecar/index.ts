import type { Server } from 'node:http'
import { finalizeTrackedChildren, installTrackedChildShutdownHooks } from './git/spawn'
import { finalizeLogContinuations } from './operations/log-stream'
import { createSidecarServer } from './server/http'
import type { SidecarCommand, SidecarMessage, SidecarStartMessage } from './server/protocol'
import { finalizeFetchSemaphores } from './session/fetch-semaphore'

process.env.GIT_TERMINAL_PROMPT = '0'
// Auth is system-only and never prompts, so the renderer has to explain failures from stderr alone —
// which it can only do if git reports them in one language.
process.env.LC_ALL = 'C'
const removeTrackedChildShutdownHooks = installTrackedChildShutdownHooks()

const parentPort = process.parentPort
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
