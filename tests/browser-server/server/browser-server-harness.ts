import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Exit, Scope } from 'effect4'
import {
  createFakeEnvironmentConnection,
  SERVER_PRODUCT_VERSION,
  startBrowserServer,
  type RunningBrowserServer
} from '../../../src/server/features/browser-server'

export interface BrowserServerFixture {
  readonly server: RunningBrowserServer
  readonly close: () => Promise<void>
}

export async function createWebBuild(
  rendererBuildId = 'renderer-build-test',
  productVersion = SERVER_PRODUCT_VERSION
): Promise<string> {
  const webRoot = await mkdtemp(path.join(tmpdir(), 'rebase-web-build-'))
  await mkdir(path.join(webRoot, 'assets'))
  await writeFile(
    path.join(webRoot, 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/assets/index-a1b2c3d4.js"></script></body></html>'
  )
  await writeFile(path.join(webRoot, 'assets/index-a1b2c3d4.js'), 'globalThis.REBASE_WEB=true')
  await writeFile(path.join(webRoot, 'assets/font-a1b2c3d4.woff2'), 'font')
  await writeFile(path.join(webRoot, 'assets/image-a1b2c3d4.png'), 'image')
  await writeFile(
    path.join(webRoot, 'rebase-manifest.json'),
    JSON.stringify({ rendererBuildId, productVersion })
  )
  await writeFile(path.join(webRoot, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(path.join(webRoot, 'not-public.txt'), 'must not be served')
  return webRoot
}

export async function acquireBrowserServer(options?: {
  readonly rendererBuildId?: string
  readonly nonceTtlMs?: number
  readonly now?: () => number
  readonly port?: number
  readonly readOnly?: boolean
}): Promise<BrowserServerFixture> {
  const webRoot = await createWebBuild(options?.rendererBuildId)
  const scope = await Effect.runPromise(Scope.make())
  const server = await Effect.runPromise(
    startBrowserServer({
      environmentConnection: createFakeEnvironmentConnection({
        initialPath: process.cwd(),
        readOnly: options?.readOnly ?? false
      }),
      nonceTtlMs: options?.nonceTtlMs,
      now: options?.now,
      port: options?.port,
      webRoot
    }).pipe(Effect.provideService(Scope.Scope, scope))
  )
  return {
    server,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void))
  }
}

export function requestHeaders(server: RunningBrowserServer): Record<string, string> {
  return { Host: server.authority }
}

export function browserServerFetch(
  server: Pick<RunningBrowserServer, 'authority' | 'origin' | 'port'>,
  target: string,
  init: RequestInit = {}
): Promise<Response> {
  const targetUrl = new URL(target, server.origin)
  const headers = new Headers(init.headers)
  if (!headers.has('Host')) {
    headers.set('Host', server.authority)
  }
  const method = init.method?.toUpperCase() ?? 'GET'
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: Object.fromEntries(headers),
        host: '127.0.0.1',
        method,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        port: server.port
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('error', reject)
        response.once('end', () => {
          const responseHeaders = new Headers()
          for (let index = 0; index < response.rawHeaders.length; index += 2) {
            responseHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1])
          }
          const status = response.statusCode ?? 500
          const bodyAllowed = method !== 'HEAD' && ![204, 205, 304].includes(status)
          resolve(
            new Response(bodyAllowed ? Buffer.concat(chunks) : null, {
              headers: responseHeaders,
              status
            })
          )
        })
      }
    )
    request.once('error', reject)
    if (typeof init.body === 'string' || init.body instanceof Uint8Array) {
      request.write(init.body)
    }
    request.end()
  })
}

export function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Expected a session cookie')
  }
  return setCookie.split(';', 1)[0]
}
