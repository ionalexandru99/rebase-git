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

describe('Browser Server authentication', () => {
  it('atomically exchanges one short-lived browser ticket for one strict HttpOnly session', async () => {
    const fixture = await acquireBrowserServer()
    acquired.push(fixture)

    const [first, replay] = await Promise.all([
      browserServerFetch(fixture.server, fixture.server.browserUrl, {
        headers: requestHeaders(fixture.server),
        redirect: 'manual'
      }),
      browserServerFetch(fixture.server, fixture.server.browserUrl, {
        headers: requestHeaders(fixture.server),
        redirect: 'manual'
      })
    ])

    const accepted = [first, replay].filter((response) => response.status === 303)
    const rejected = [first, replay].filter((response) => response.status === 404)
    expect(accepted).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(accepted[0].headers.get('location')).toBe('/')
    expect(accepted[0].headers.get('set-cookie')).toMatch(
      /^rebase-client=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/
    )
    expect(sessionCookie(accepted[0])).not.toContain(fixture.server.browserUrl)
  })

  it('independently exchanges each browser URL minted by the running Server', async () => {
    const fixture = await acquireBrowserServer()
    acquired.push(fixture)
    const additionalBrowserUrl = fixture.server.mintBrowserUrl()

    const initial = await browserServerFetch(fixture.server, fixture.server.browserUrl, {
      headers: requestHeaders(fixture.server),
      redirect: 'manual'
    })
    const additional = await browserServerFetch(fixture.server, additionalBrowserUrl, {
      headers: requestHeaders(fixture.server),
      redirect: 'manual'
    })
    const replay = await browserServerFetch(fixture.server, additionalBrowserUrl, {
      headers: requestHeaders(fixture.server),
      redirect: 'manual'
    })

    expect(initial.status).toBe(303)
    expect(additional.status).toBe(303)
    expect(replay.status).toBe(404)
  })

  it('rejects an expired ticket without setting a cookie', async () => {
    let now = 1_000
    const fixture = await acquireBrowserServer({ nonceTtlMs: 50, now: () => now })
    acquired.push(fixture)
    now = 1_050

    const response = await browserServerFetch(fixture.server, fixture.server.browserUrl, {
      headers: requestHeaders(fixture.server),
      redirect: 'manual'
    })

    expect(response.status).toBe(404)
    expect(response.headers.has('set-cookie')).toBe(false)
  })

  it('does not consume a ticket on HEAD and rate-limits repeated bootstrap failures', async () => {
    const fixture = await acquireBrowserServer()
    acquired.push(fixture)

    const head = await browserServerFetch(fixture.server, fixture.server.browserUrl, {
      method: 'HEAD',
      headers: requestHeaders(fixture.server),
      redirect: 'manual'
    })
    const accepted = await browserServerFetch(fixture.server, fixture.server.browserUrl, {
      headers: requestHeaders(fixture.server),
      redirect: 'manual'
    })
    const failures: Response[] = []
    for (let index = 0; index < 9; index += 1) {
      failures.push(
        await browserServerFetch(fixture.server, `/auth/not-a-ticket-${index}`, {
          headers: requestHeaders(fixture.server),
          redirect: 'manual'
        })
      )
    }

    expect(head.status).toBe(405)
    expect(accepted.status).toBe(303)
    expect(failures.slice(0, 8).map((response) => response.status)).toEqual(
      Array.from({ length: 8 }, () => 404)
    )
    expect(failures[8].status).toBe(429)
  })
})
