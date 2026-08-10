import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireBrowserServer,
  browserServerFetch,
  type BrowserServerFixture,
  requestHeaders,
  sessionCookie
} from './browser-server-harness'

const acquired: BrowserServerFixture[] = []

afterEach(async () => {
  await Promise.all(acquired.splice(0).map((fixture) => fixture.close()))
})

async function authenticate(fixture: BrowserServerFixture): Promise<string> {
  const response = await browserServerFetch(fixture.server, fixture.server.browserUrl, {
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
    const wrongOrigin = await browserServerFetch(fixture.server, '/api/bootstrap', {
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

    const response = await browserServerFetch(fixture.server, '/api/bootstrap', {
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
    const bootstrapResponse = await browserServerFetch(fixture.server, '/api/bootstrap', {
      headers: clientHeaders(fixture, cookie)
    })
    const bootstrap = (await bootstrapResponse.json()) as { csrfToken: string }

    const staleBuild = await browserServerFetch(fixture.server, '/api/bootstrap', {
      headers: clientHeaders(fixture, cookie, { 'X-Rebase-Renderer-Build-Id': 'old-build' })
    })
    const staleServer = await browserServerFetch(fixture.server, '/api/bootstrap', {
      headers: clientHeaders(fixture, cookie, {
        'X-Rebase-Server-Instance-Id': 'old-server-instance'
      })
    })
    const missingCsrf = await browserServerFetch(fixture.server, '/api/unknown-write', {
      method: 'POST',
      headers: clientHeaders(fixture, cookie, { Origin: fixture.server.origin })
    })
    const validCsrf = await browserServerFetch(fixture.server, '/api/unknown-write', {
      method: 'POST',
      headers: clientHeaders(fixture, cookie, {
        Origin: fixture.server.origin,
        'X-Rebase-Csrf-Token': bootstrap.csrfToken
      })
    })

    expect(staleBuild.status).toBe(409)
    await expect(staleBuild.json()).resolves.toMatchObject({ reload: true })
    expect(staleServer.status).toBe(409)
    await expect(staleServer.json()).resolves.toMatchObject({ reload: true })
    expect(missingCsrf.status).toBe(403)
    expect(validCsrf.status).toBe(404)
  })

  it('rejects all writes in read-only mode after authentication and CSRF validation', async () => {
    const fixture = await acquireBrowserServer({ readOnly: true })
    acquired.push(fixture)
    const cookie = await authenticate(fixture)
    const bootstrapResponse = await browserServerFetch(fixture.server, '/api/bootstrap', {
      headers: clientHeaders(fixture, cookie)
    })
    const bootstrap = (await bootstrapResponse.json()) as { csrfToken: string }

    const response = await browserServerFetch(fixture.server, '/api/unknown-write', {
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

    const html = await browserServerFetch(fixture.server, '/', {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const asset = await browserServerFetch(fixture.server, '/assets/index-a1b2c3d4.js', {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const font = await browserServerFetch(fixture.server, '/assets/font-a1b2c3d4.woff2', {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const image = await browserServerFetch(fixture.server, '/assets/image-a1b2c3d4.png', {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const favicon = await browserServerFetch(fixture.server, '/favicon.svg', {
      headers: { ...requestHeaders(fixture.server), Cookie: cookie }
    })
    const forgedCookie = await browserServerFetch(fixture.server, '/', {
      headers: { ...requestHeaders(fixture.server), Cookie: 'rebase-client=fake' }
    })
    const nonPublicFile = await browserServerFetch(fixture.server, '/not-public.txt', {
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
    expect(font.headers.get('content-type')).toBe('font/woff2')
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(favicon.headers.get('cache-control')).toBe('no-store')
    expect(forgedCookie.status).toBe(401)
    expect(nonPublicFile.status).toBe(404)
    expect(traversal).toBe(400)
  })

  it('keeps simultaneous localhost Server sessions isolated by origin', async () => {
    const first = await acquireBrowserServer()
    const second = await acquireBrowserServer()
    acquired.push(first, second)
    const firstCookie = await authenticate(first)
    const secondCookie = await authenticate(second)
    expect(first.server.origin).not.toBe(second.server.origin)
    expect(new URL(first.server.origin).hostname).toMatch(/^rebase-[a-f0-9]+\.localhost$/)
    expect(firstCookie.split('=', 1)[0]).toBe(secondCookie.split('=', 1)[0])

    const firstBootstrap = await browserServerFetch(first.server, '/api/bootstrap', {
      headers: clientHeaders(first, firstCookie)
    })
    const secondBootstrap = await browserServerFetch(second.server, '/api/bootstrap', {
      headers: clientHeaders(second, secondCookie)
    })
    const crossOriginSession = await browserServerFetch(first.server, '/api/bootstrap', {
      headers: clientHeaders(first, secondCookie)
    })

    expect(firstBootstrap.status).toBe(200)
    expect(secondBootstrap.status).toBe(200)
    expect(crossOriginSession.status).toBe(401)
  })

  it('reloads an old tab without granting it a session after a Server restart', async () => {
    const first = await acquireBrowserServer()
    acquired.push(first)
    const oldCookie = await authenticate(first)
    const port = first.server.port
    await first.close()
    acquired.splice(acquired.indexOf(first), 1)

    const restarted = await acquireBrowserServer({ port })
    acquired.push(restarted)
    expect(restarted.server.origin).not.toBe(first.server.origin)
    const staleTabResponse = await browserServerFetch(restarted.server, '/api/bootstrap', {
      headers: clientHeaders(first, oldCookie)
    })
    const oldSessionAtNewOrigin = await browserServerFetch(restarted.server, '/api/bootstrap', {
      headers: clientHeaders(restarted, oldCookie)
    })

    expect(staleTabResponse.status).toBe(409)
    await expect(staleTabResponse.json()).resolves.toEqual({
      error: 'stale-client',
      reload: true
    })
    expect(staleTabResponse.headers.get('cache-control')).toBe('no-store')
    expect(staleTabResponse.headers.has('set-cookie')).toBe(false)
    expect(staleTabResponse.headers.has('location')).toBe(false)
    expect(oldSessionAtNewOrigin.status).toBe(401)
  })
})
