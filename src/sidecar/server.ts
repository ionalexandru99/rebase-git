import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import * as operations from './operations'
import { SidecarOp } from './protocol'

type Body = Record<string, unknown>

const str = (body: Body, key: string): string => {
  const value = body[key]
  return typeof value === 'string' ? value : ''
}

async function dispatch(op: string, body: Body): Promise<unknown> {
  switch (op) {
    case SidecarOp.openRepo:
      return operations.openRepo(str(body, 'repoPath'))
    case SidecarOp.closeRepo:
      return operations.closeRepo(str(body, 'repoPath'))
    case SidecarOp.getBranches:
      return operations.getBranches(str(body, 'repoPath'))
    case SidecarOp.getStatus:
      return operations.getStatus(str(body, 'repoPath'))
    case SidecarOp.stageFile:
      return operations.stageFile(str(body, 'repoPath'), str(body, 'file'))
    case SidecarOp.unstageFile:
      return operations.unstageFile(str(body, 'repoPath'), str(body, 'file'))
    case SidecarOp.commit:
      return operations.commit(str(body, 'repoPath'), str(body, 'message'))
    case SidecarOp.fetchRepo:
      return operations.fetchRepo(str(body, 'repoPath'))
    case SidecarOp.getLog:
      return operations.getLog(
        str(body, 'repoPath'),
        typeof body.maxCount === 'number' ? body.maxCount : undefined
      )
    case SidecarOp.checkoutRef:
      return operations.checkoutRef(
        str(body, 'repoPath'),
        body.refKind as 'local' | 'remote' | 'tag',
        str(body, 'fullPath')
      )
    case SidecarOp.scanForRepos:
      return operations.scanForRepos(str(body, 'dirPath'))
    default:
      return undefined
  }
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw) as Body)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400'
} as const

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', ...CORS_HEADERS })
  res.end(data)
}

async function handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    const requestedHeaders = req.headers['access-control-request-headers']
    res.writeHead(204, {
      ...CORS_HEADERS,
      'access-control-allow-headers':
        requestedHeaders ?? CORS_HEADERS['access-control-allow-headers'],
      'access-control-allow-private-network': 'true'
    })
    res.end()
    return
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.headers.authorization !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  const match = url.pathname.match(/^\/op\/(.+)$/)
  if (!match || req.method !== 'POST') {
    sendJson(res, 404, { error: 'not found' })
    return
  }

  try {
    const body = await readBody(req)
    const result = await dispatch(match[1], body)
    if (result === undefined) {
      sendJson(res, 404, { error: `unknown op: ${match[1]}` })
      return
    }
    sendJson(res, 200, result)
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function createSidecarServer(token: string): Server {
  return createServer((req, res) => {
    void handle(req, res, token)
  })
}
