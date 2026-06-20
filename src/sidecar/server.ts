import fs from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { parseOrThrow } from '@shared/codec'
import { type ScanForReposResponse, ScanForReposResponseSchema } from '@shared/schemas/ipc'
import { LogStreamRequestSchema } from '@shared/schemas/log-stream'
import { Either, Schema } from 'effect'
import { simpleGit } from 'simple-git'
import { BAD_REQUEST, dispatch } from './dispatch'
import { streamGitLog } from './log-stream'
import { resolveExistingRepoRoot } from './path-guards'
import { SidecarOp } from './protocol'
import { handleRpcRequest } from './rpc-handlers'

type Body = Record<string, unknown>

const MAX_BODY_BYTES = 1024 * 1024

class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError'
}

const requiredString = (body: Body, key: string): string | null => {
  const value = body[key]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  return trimmed
}

function safeRepoPath(body: Body): string | null | typeof BAD_REQUEST {
  const raw = requiredString(body, 'repoPath')
  if (!raw) {
    return BAD_REQUEST
  }
  return resolveExistingRepoRoot(raw)
}

const invalidScanDirectoryResponse = (): ScanForReposResponse =>
  parseOrThrow(ScanForReposResponseSchema, {
    _tag: 'GitError',
    message: 'invalid directory path'
  })

async function scanForReposSafely(requestedDirPath: string): Promise<ScanForReposResponse> {
  if (!requestedDirPath || requestedDirPath.includes('\0')) {
    return invalidScanDirectoryResponse()
  }
  if (!path.isAbsolute(requestedDirPath)) {
    return invalidScanDirectoryResponse()
  }
  if (requestedDirPath.split(/[/\\]/).includes('..')) {
    return invalidScanDirectoryResponse()
  }

  let scanRoot: string
  try {
    scanRoot = fs.realpathSync.native(path.resolve(requestedDirPath))
    if (!fs.statSync(scanRoot).isDirectory()) {
      return invalidScanDirectoryResponse()
    }
  } catch {
    return invalidScanDirectoryResponse()
  }

  const resolvedPath = path.resolve(requestedDirPath)
  const scanRootPrefix = scanRoot.endsWith(path.sep) ? scanRoot : `${scanRoot}${path.sep}`
  if (resolvedPath !== scanRoot && !resolvedPath.startsWith(scanRootPrefix)) {
    return invalidScanDirectoryResponse()
  }

  try {
    const entries = await fs.promises.readdir(scanRoot, { withFileTypes: true })
    const repos: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const childName = path.basename(entry.name)
      if (childName !== entry.name) {
        continue
      }
      const childPath = path.join(scanRoot, childName)
      if (!childPath.startsWith(scanRootPrefix)) {
        continue
      }
      try {
        const git = simpleGit(childPath)
        const isRepo = await git.checkIsRepo()
        if (isRepo) {
          repos.push(childPath)
        }
      } catch {}
    }
    return parseOrThrow(ScanForReposResponseSchema, { _tag: 'Ok', repos })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return parseOrThrow(ScanForReposResponseSchema, { _tag: 'GitError', message })
  }
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let rejected = false
    req.on('data', (chunk: Buffer) => {
      if (rejected) {
        return
      }
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        rejected = true
        chunks.length = 0
        req.resume()
        reject(new BodyTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks).toString('utf8'))
      }
    })
    req.on('error', reject)
  })
}

async function readBody(req: IncomingMessage): Promise<Body> {
  const raw = await readRawBody(req)
  return raw ? (JSON.parse(raw) as Body) : {}
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(data)
}

async function handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    res.writeHead(403)
    res.end()
    return
  }

  if (req.headers.authorization !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/rpc' && req.method === 'POST') {
    try {
      const rawBody = await readRawBody(req)
      const request = new Request('http://localhost/rpc', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] ?? 'application/ndjson' },
        body: rawBody
      })
      const response = await handleRpcRequest(request)
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })
      res.writeHead(response.status, headers)
      if (response.body) {
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res)
      } else {
        res.end(await response.text())
      }
    } catch (error) {
      console.error('[sidecar] rpc error', error)
      if (error instanceof BodyTooLargeError) {
        sendJson(res, 413, { error: 'payload too large' })
        return
      }
      sendJson(res, 500, { error: 'internal error' })
    }
    return
  }

  if (url.pathname === '/stream/log' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST || !repoPath) {
        sendJson(res, 400, { error: 'bad request' })
        return
      }
      const parsed = Schema.decodeUnknownEither(LogStreamRequestSchema)({
        repoPath,
        skip: body.skip,
        maxCount: body.maxCount,
        streamId: body.streamId
      })
      if (Either.isLeft(parsed)) {
        sendJson(res, 400, { error: 'bad request' })
        return
      }
      const { skip, maxCount, streamId } = parsed.right
      streamGitLog(repoPath, res, { skip, maxCount, streamId })
    } catch (error) {
      console.error('[sidecar] request error', error)
      if (error instanceof BodyTooLargeError) {
        sendJson(res, 413, { error: 'payload too large' })
        return
      }
      sendJson(res, 500, { error: 'internal error' })
    }
    return
  }

  const match = url.pathname.match(/^\/op\/(.+)$/)
  if (!match || req.method !== 'POST') {
    sendJson(res, 404, { error: 'not found' })
    return
  }

  try {
    const body = await readBody(req)
    const operation = match[1]
    if (operation === SidecarOp.scanForRepos) {
      const dirPath = requiredString(body, 'dirPath')
      if (!dirPath) {
        sendJson(res, 400, { error: 'bad request' })
        return
      }
      const result = await scanForReposSafely(dirPath)
      sendJson(res, 200, result)
      return
    }
    const result = await dispatch(operation, body)
    if (result === BAD_REQUEST) {
      sendJson(res, 400, { error: 'bad request' })
      return
    }
    // Unknown ops keep a plain 404 rather than a typed error: `op` is statically `SidecarOpName`
    // end-to-end (the registry's AssertEqual + the exhaustive opHandlers map guarantee every op has
    // an entry), and read ops are served by the RPC group, so this path is unreachable from the app
    // and only fires for a foreign client or a bug. A bespoke error tag would bloat the response
    // unions for a case the renderer cannot produce.
    if (result === undefined) {
      sendJson(res, 404, { error: `unknown op: ${match[1]}` })
      return
    }
    sendJson(res, 200, result)
  } catch (error) {
    console.error('[sidecar] request error', error)
    if (error instanceof BodyTooLargeError) {
      sendJson(res, 413, { error: 'payload too large' })
      return
    }
    sendJson(res, 500, { error: 'internal error' })
  }
}

export function createSidecarServer(token: string): Server {
  return createServer((req, res) => {
    void handle(req, res, token)
  })
}
