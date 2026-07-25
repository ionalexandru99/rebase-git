import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { runWithRequestChildren } from '../git/spawn'
import { handleRpcRequest } from './handlers'

const MAX_BODY_BYTES = 1024 * 1024

class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError'
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

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(data)
}

// Constant-time bearer-token check so a request can't probe the token byte-by-byte via response
// timing. The length compare is a cheap guard (timingSafeEqual throws on unequal lengths); the token
// length is not secret.
function isAuthorized(header: string | undefined, token: string): boolean {
  if (typeof header !== 'string') {
    return false
  }
  const provided = Buffer.from(header)
  const expected = Buffer.from(`Bearer ${token}`)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

async function handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  // Authenticate before anything else (including OPTIONS) so every unauthorized request gets a
  // uniform 401 and the auth path can't be skipped by method or route.
  if (!isAuthorized(req.headers.authorization, token)) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
  } catch {
    sendJson(res, 400, { error: 'bad request' })
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(403)
    res.end()
    return
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/rpc' && req.method === 'POST') {
    const controller = new AbortController()
    const abort = () => controller.abort()
    const abortIfIncomplete = () => {
      if (!res.writableFinished) {
        abort()
      }
    }
    req.once('aborted', abort)
    res.once('close', abortIfIncomplete)
    try {
      const rawBody = await readRawBody(req)
      const request = new Request('http://localhost/rpc', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] ?? 'application/ndjson' },
        body: rawBody,
        signal: controller.signal
      })
      await runWithRequestChildren(controller.signal, async () => {
        const response = await handleRpcRequest(request)
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key] = value
        })
        res.writeHead(response.status, headers)
        if (response.body) {
          await pipeline(
            Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
            res,
            { signal: controller.signal }
          )
        } else {
          res.end(await response.text())
        }
      })
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) {
        return
      }
      console.error('[sidecar] rpc error', error)
      if (error instanceof BodyTooLargeError) {
        sendJson(res, 413, { error: 'payload too large' })
        return
      }
      sendJson(res, 500, { error: 'internal error' })
    } finally {
      req.off('aborted', abort)
      res.off('close', abortIfIncomplete)
    }
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

export function createSidecarServer(token: string): Server {
  return createServer((req, res) => {
    void handle(req, res, token)
  })
}
