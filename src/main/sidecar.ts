import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { SidecarMessage, SidecarOpName } from '../sidecar/protocol'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000

interface Sidecar {
  child: UtilityProcess
  baseUrl: string
  token: string
}

let sidecar: Sidecar | null = null
let startup: Promise<Sidecar> | null = null

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

async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`)
    return response.ok
  } catch {
    return false
  }
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await checkHealth(baseUrl)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('sidecar health check timed out')
}

async function spawn(): Promise<Sidecar> {
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

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('sidecar start timed out')), START_TIMEOUT_MS)
    const onMessage = (message: SidecarMessage) => {
      if (message.type === 'ready') {
        clearTimeout(timeout)
        child.off('message', onMessage)
        resolve()
      } else if (message.type === 'error') {
        clearTimeout(timeout)
        child.off('message', onMessage)
        reject(new Error(message.message))
      }
    }
    child.on('message', onMessage)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`sidecar exited before ready (code ${code})`))
    })
    child.postMessage({ type: 'start', hostname, port, token })
  })

  await waitForHealth(baseUrl)
  return { child, baseUrl, token }
}

export function startSidecar(): Promise<Sidecar> {
  if (startup) return startup
  startup = spawn().then((started) => {
    sidecar = started
    started.child.once('exit', () => {
      if (sidecar?.child === started.child) {
        sidecar = null
        startup = null
      }
    })
    return started
  })
  startup.catch(() => {
    startup = null
  })
  return startup
}

async function ensureSidecar(): Promise<Sidecar> {
  if (sidecar) return sidecar
  return startSidecar()
}

export async function getSidecarConfig(): Promise<{ baseUrl: string; token: string }> {
  const { baseUrl, token } = await ensureSidecar()
  return { baseUrl, token }
}

export async function sidecarRequest<T>(
  op: SidecarOpName,
  body: Record<string, unknown>
): Promise<T> {
  const { baseUrl, token } = await ensureSidecar()
  const response = await fetch(`${baseUrl}/op/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    throw new Error(`sidecar ${op} failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

export async function killSidecar(): Promise<void> {
  const current = sidecar
  sidecar = null
  startup = null
  if (!current) return
  await new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    current.child.once('exit', done)
    current.child.postMessage({ type: 'stop' })
    setTimeout(() => {
      current.child.kill()
      done()
    }, STOP_TIMEOUT_MS)
  })
}
