import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Exit, Scope } from 'effect4'
import {
  createFakeEnvironmentConnection,
  startBrowserServer,
  type RunningBrowserServer
} from '../../../src/server/features/browser-server'

export interface BrowserServerFixture {
  readonly server: RunningBrowserServer
  readonly close: () => Promise<void>
}

export async function createWebBuild(rendererBuildId = 'renderer-build-test'): Promise<string> {
  const webRoot = await mkdtemp(path.join(tmpdir(), 'rebase-web-build-'))
  await mkdir(path.join(webRoot, 'assets'))
  await writeFile(
    path.join(webRoot, 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/assets/index-a1b2c3d4.js"></script></body></html>'
  )
  await writeFile(path.join(webRoot, 'assets/index-a1b2c3d4.js'), 'globalThis.REBASE_WEB=true')
  await writeFile(
    path.join(webRoot, 'rebase-manifest.json'),
    JSON.stringify({ rendererBuildId, productVersion: '0.0.2' })
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

export function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Expected a session cookie')
  }
  return setCookie.split(';', 1)[0]
}
