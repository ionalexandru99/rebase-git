import type { Server } from 'node:http'
import type { SidecarCommand, SidecarMessage, SidecarStartMessage } from './protocol'
import { createSidecarServer } from './server'

// The sidecar runs git non-interactively; without this a credentialed fetch/commit/checkout can
// block forever on a terminal prompt. Set process-wide so both simple-git and raw spawns inherit it.
process.env.GIT_TERMINAL_PROMPT = '0'

const parentPort = process.parentPort
let server: Server | undefined

function post(message: SidecarMessage): void {
  parentPort.postMessage(message)
}

function start(command: SidecarStartMessage): void {
  try {
    server = createSidecarServer(command.token)
    server.on('error', (error) => {
      post({ type: 'error', message: error.message })
      setImmediate(() => process.exit(1))
    })
    server.listen(command.port, command.hostname, () => {
      post({ type: 'ready' })
    })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    setImmediate(() => process.exit(1))
  }
}

function stop(): void {
  const current = server
  server = undefined
  if (!current) {
    process.exit(0)
    return
  }
  current.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}

parentPort.on('message', (event: { data: SidecarCommand }) => {
  const command = event.data
  if (command.type === 'start') {
    start(command)
  } else if (command.type === 'stop') {
    stop()
  }
})
