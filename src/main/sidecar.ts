import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LogChunk } from '@shared/schemas/git'
import { Context, Effect, ManagedRuntime } from 'effect'
import { utilityProcess } from 'electron'
import type { SidecarMessage } from '../sidecar/protocol'
import {
  createSidecarLifecycleLayer,
  type SidecarLifecycle,
  type SidecarResource
} from './sidecar-lifecycle'
import { callRpcByTag, runStreamLog } from './sidecar-rpc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000

interface Sidecar {
  baseUrl: string
  token: string
}

function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address !== 'object' || !address) {
        server.close()
        reject(new Error('failed to allocate port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

async function checkHealth(baseUrl: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1_000)
    })
    return response.ok
  } catch {
    return false
  }
}

async function waitForHealth(baseUrl: string, token: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await checkHealth(baseUrl, token)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('sidecar health check timed out')
}

async function launchSidecar(): Promise<SidecarResource<Sidecar>> {
  const hostname = '127.0.0.1'
  const port = await allocatePort()
  const token = randomUUID()
  const baseUrl = `http://${hostname}:${port}`
  const child = utilityProcess.fork(path.join(__dirname, 'sidecar.js'), [], {
    serviceName: 'rebase git sidecar',
    stdio: 'pipe'
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    console.error('[sidecar]', chunk.toString('utf8').trimEnd())
  })
  child.stdout?.resume()

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })

  const ready = (async () => {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('sidecar start timed out')),
        START_TIMEOUT_MS
      )
      const cleanup = () => {
        clearTimeout(timeout)
        child.off('message', onMessage)
        child.off('exit', onExit)
      }
      const onMessage = (message: SidecarMessage) => {
        if (message.type === 'ready') {
          cleanup()
          resolve()
        } else if (message.type === 'error') {
          cleanup()
          reject(new Error(message.message))
        }
      }
      const onExit = (code: number) => {
        cleanup()
        reject(new Error(`sidecar exited before ready (code ${code})`))
      }
      child.on('message', onMessage)
      child.once('exit', onExit)
      child.postMessage({ type: 'start', hostname, port, token })
    })
    await Promise.race([
      waitForHealth(baseUrl, token),
      exited.then(() => {
        throw new Error('sidecar exited before health check completed')
      })
    ])
  })()

  let stopPromise: Promise<void> | null = null
  const stop = (): Promise<void> => {
    if (stopPromise) {
      return stopPromise
    }
    stopPromise = (async () => {
      try {
        child.postMessage({ type: 'stop' })
      } catch {
        try {
          child.kill()
        } catch {}
      }
      const forceKill = setTimeout(() => {
        try {
          child.kill()
        } catch {}
      }, STOP_TIMEOUT_MS)
      try {
        await exited
      } finally {
        clearTimeout(forceKill)
      }
    })()
    return stopPromise
  }

  return { value: { baseUrl, token }, ready, exited, stop }
}

const SidecarLifecycleService =
  Context.GenericTag<SidecarLifecycle<Sidecar>>('main/SidecarLifecycle')
const sidecarRuntime = ManagedRuntime.make(
  createSidecarLifecycleLayer(SidecarLifecycleService, { launch: launchSidecar })
)

function runWithSidecarLifecycle<A>(
  operation: (lifecycle: SidecarLifecycle<Sidecar>) => Promise<A>
): Promise<A> {
  return sidecarRuntime.runPromise(
    SidecarLifecycleService.pipe(
      Effect.flatMap((lifecycle) => Effect.promise(() => operation(lifecycle)))
    )
  )
}

export function startSidecar(): Promise<Sidecar> {
  return runWithSidecarLifecycle((lifecycle) => lifecycle.start())
}

async function ensureSidecar(): Promise<Sidecar> {
  return runWithSidecarLifecycle((lifecycle) => lifecycle.start())
}

export async function restartSidecar(): Promise<void> {
  await runWithSidecarLifecycle((lifecycle) => lifecycle.restart())
}

export async function sidecarRpcCall(
  tag: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { baseUrl, token } = await ensureSidecar()
  return callRpcByTag(tag, baseUrl, token, body)
}

export interface LogStreamOptions {
  skip?: number
  maxCount?: number
  streamId?: number
}

export async function sidecarLogStream(
  repoPath: string,
  signal: AbortSignal,
  onStarted: () => void,
  onChunk: (chunk: LogChunk) => void,
  options?: LogStreamOptions
): Promise<void> {
  const { baseUrl, token } = await ensureSidecar()
  let started = false
  await runStreamLog(
    baseUrl,
    token,
    { repoPath, skip: options?.skip, maxCount: options?.maxCount, streamId: options?.streamId },
    signal,
    (chunk) => {
      if (!started) {
        started = true
        onStarted()
      }
      onChunk(chunk)
    }
  )
}

export async function killSidecar(): Promise<void> {
  await sidecarRuntime.dispose()
}
