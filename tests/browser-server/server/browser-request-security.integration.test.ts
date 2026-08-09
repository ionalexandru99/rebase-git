import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireBrowserServer,
  type BrowserServerFixture,
  requestHeaders,
  sessionCookie
} from './browser-server-harness'

const acquired: BrowserServerFixture[] = []

afterEach(async () => {
  await Promise.all(acquired.splice(0).map((fixture) => fixture.close()))
})

async function authenticate(fixture: BrowserServerFixture): Promise<string> {
  const response = await fetch(fixture.server.browserUrl, {
    headers: requestHeaders(fixture.server),
    redirect: 'manual'
  })
  return sessionCookie(response)
}

function clientHeaders(
  fixture: BrowserServerFixture,
  cookie: string,
  additions: Record<string, string> = {}
): Record<string, string> {
  return {
    ...requestHeaders(fixture.server),
    Cookie: cookie,
    'X-Rebase-Renderer-Build-Id': fixture.server.rendererBuildId,
    'X-Rebase-Server-Instance-Id': fixture.server.serverInstanceId,
    ...additions
  }
}

describe('Browser Server request security', () => {
  it('rejects unexpected Host and Origin values without enabling CORS', async () => {
    const fixture = await acquireBrowserServer()
    acquired.push(fixture)
    const cookie = await authenticate(fixture)

    const wrongHost = await new Promise<{ headers: typeof import('node:http').IncomingHttpHeaders; status: number }>((resolve, reject) => {
      const request = httpRequest(
        {
          headers: clientHeaders(fixture, cookie, { Host: `evil.test:${fixture.server.port}` }),
          host: '127.0.0.1',
          path: '/api/bootstrap',
          port: fixture.server.port
        },
        (response) => {
          response.resume()
          resolve({ headers: response.headers, status: response.statusCode ?? 0 })
        }
      )
      request.once('error', reject)
      request.end()
    })
    const wrongOrigin = await fetch(`${fixture.server.origin}/api/bootstrap`, {
      headers: clientHeaders(fixture, cookie, { Origin: 'https://evil.test' })
    })

    expect(wrongHost.status).toBe(403)
    expect(wrongOrigin.status).toBe(403)
    expect(wrongHost.headers['access-control-allow-origin']).toBeUndefined()
    expect(wrongOrigin.headers.has('access-control-allow-origin')).toBe(false)
  })

  it('rejects duplicate Host headers before application routing', async () => {
    const fixture = await acquireBrowserServer()
    acquired.push(fixture)

    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: fixture.server.port })
      let received = ''
      socket.setEncoding('utf8')
      socket.once('error', reject)
      socket.on('data', (chunk) => {
        received += chunk
      })
      socket.once('end', () => resolve(received))
      socket.once('connect', () => {
        socket.end(
          `GET /.well-known/rebase/health HTTP/1.1\r\nHost: ${fixture.server.authority}\r\nHost: evil.test:${fixture.server.port}\r\nConnection: close\r\n\r\n`
        )
      })
    })

    expect(response).toMatch(/^HTTP\/1\.1 (?:400|403) /)
  })

  it('returns only browser-safe bootstrap data to a matching authenticated build', async () => {
    const fixture = await acquireBrowserServer()
    acquired.push(fixture)
    const cookie = await authenticate(fixture)

    const response = await fetch(`${fixture.server.origin}/api/bootstrap`, {
      headers: clientHeaders(fixture, cookie)
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      csrfToken: expect.any(String),
      environment: { environmentId: 'local', path: process.cwd() },
      readOnly: false
    })
    expect(JSON.stringify(body)).not.toMatch(/endpoint|credential|sessionToken|bootstrapSecret/)
  })

  it('requires matching build and instance IDs and CSRF protection for writes', async () => {
    const fixture = await acquireBrowserServer()
    acquired.push(fixture)
    const cookie = await authenticate(fixture)
    const bootstrapResponse = await fetch(`${fixture.server.origin}/api/bootstrap`, {
      headers: clientHeaders(fixture, cookie)
    })
    const bootstrap = (await bootstrapResponse.json()) as { csrfToken: string }

    const staleBuild = await fetch(`${fixture.server.origin}/api/bootstrap`, {
      headers: clientHeaders(fixture, cookie, { 'X-Rebase-Renderer-Build-Id': 'old-build' })
    })
    const missingCsrf = await fetch(`${fixture.server.origin}/api/unknown-write`, {
      method: 'POST',
      headers: clientHeaders(fixture, cookie, { Origin: fixture.server.origin })
    })
    const validCsrf = await fetch(`${fixture.server.origin}/api/unknown-write`, {
      method: 'POST',
      headers: clientHeaders(fixture, cookie, {
        Origin: fixture.server.origin,
        'X-Rebase-Csrf-Token': bootstrap.csrfToken
      })
    })

    expect(staleBuild.status).toBe(409)
    await expect(staleBuild.json()).resolves.toMatchObject({ reload: true })
    expect(missingCsrf.status).toBe(403)
    expect(validCsrf.status).toBe(404)
  })

  it('rejects all writes in read-only mode after authentication and CSRF validation', async () => {
    const fixture = await acquireBrowserServer({ readOnly: true })
    acquired.push(fixture)
    const cookie = await authenticate(fixture)
    const bootstrapResponse = await fetch(`${fixture.server.origin}/api/bootstrap`, {
      headers: clientHeaders(fixture, cookie)
    })
    const bootstrap = (await bootstrapResponse.json()) as { csrfToken: string }

    const response = await fetch(`${fixture.server.origin}/api/unknown-write`, {
      method: 'POST',
      headers: clientHeaders(fixture, cookie, {
        Origin: fixture.server.origin,
        'X-Rebase-Csrf-Token': bootstrap.csrfToken
      })
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'read-only' })
  })

  it('serves authenticated exact-build assets with strict cache and response policies', async () => {
    const fixture = await acquireBrowserServer()
    acquired.push(fixture)
    const cookie = await authenticate(fixture)

    const html = await fetch(`${fixture.server.origin}/`, {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const asset = await fetch(`${fixture.server.origin}/assets/index-a1b2c3d4.js`, {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const favicon = await fetch(`${fixture.server.origin}/favicon.svg`, {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const forgedCookie = await fetch(`${fixture.server.origin}/`, {
      headers: { ...requestHeaders(fixture.server), Cookie: `rebase-client-${fixture.server.port}=fake` }
    })
    const nonPublicFile = await fetch(`${fixture.server.origin}/not-public.txt`, {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const traversal = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          headers: { ...requestHeaders(fixture.server), Cookie: cookie },
          host: '127.0.0.1',
          path: '/assets/%2e%2e/index.html',
          port: fixture.server.port
        },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        }
      )
      request.once('error', reject)
      request.end()
    })

    expect(html.status).toBe(200)
    expect(await html.text()).toContain(fixture.server.serverInstanceId)
    expect(html.headers.get('cache-control')).toBe('no-store')
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(html.headers.get('x-content-type-options')).toBe('nosniff')
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(favicon.headers.get('cache-control')).toBe('no-store')
    expect(forgedCookie.status).toBe(401)
    expect(nonPublicFile.status).toBe(404)
    expect(traversal).toBe(400)
  })

  it('keeps simultaneous localhost Server sessions isolated by port', async () => {
    const first = await acquireBrowserServer()
    const second = await acquireBrowserServer()
    acquired.push(first, second)
    const firstCookie = await authenticate(first)
    const secondCookie = await authenticate(second)
    const combinedCookies = `${firstCookie}; ${secondCookie}`

    expect(firstCookie.split('=', 1)[0]).not.toBe(secondCookie.split('=', 1)[0])

    const firstBootstrap = await fetch(`${first.server.origin}/api/bootstrap`, {
      headers: clientHeaders(first, combinedCookies)
    })
    const secondBootstrap = await fetch(`${second.server.origin}/api/bootstrap`, {
      headers: clientHeaders(second, combinedCookies)
    })

    expect(firstBootstrap.status).toBe(200)
    expect(secondBootstrap.status).toBe(200)
  })

  it('rejects an old session after a Server restarts on the same port', async () => {
    const first = await acquireBrowserServer()
    acquired.push(first)
    const oldCookie = await authenticate(first)
    const port = first.server.port
    await first.close()
    acquired.splice(acquired.indexOf(first), 1)

    const restarted = await acquireBrowserServer({ port })
    acquired.push(restarted)
    const response = await fetch(`${restarted.server.origin}/api/bootstrap`, {
      headers: clientHeaders(restarted, oldCookie)
    })

    expect(response.status).toBe(401)
  })
})
