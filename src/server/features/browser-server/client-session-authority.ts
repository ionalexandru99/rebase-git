import { createHash, randomBytes } from 'node:crypto'

interface BrowserTicket {
  readonly expiresAt: number
}

export interface ClientSession {
  readonly csrfToken: string
  readonly rendererBuildId: string
  readonly serverInstanceId: string
}

export interface ClientSessionAuthority {
  readonly mintBrowserTicket: () => string
  readonly exchangeBrowserTicket: (ticket: string) =>
    | { readonly accepted: false }
    | {
        readonly accepted: true
        readonly sessionToken: string
      }
  readonly findSession: (sessionToken: string) => ClientSession | undefined
}

function secretDigest(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function randomSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function createClientSessionAuthority(options: {
  readonly now: () => number
  readonly nonceTtlMs: number
  readonly rendererBuildId: string
  readonly serverInstanceId: string
}): ClientSessionAuthority {
  const browserTickets = new Map<string, BrowserTicket>()
  const clientSessions = new Map<string, ClientSession>()

  return {
    mintBrowserTicket: () => {
      const mintedAt = options.now()
      for (const [digest, existingTicket] of browserTickets) {
        if (existingTicket.expiresAt <= mintedAt) {
          browserTickets.delete(digest)
        }
      }
      const ticket = randomSecret()
      browserTickets.set(secretDigest(ticket), { expiresAt: mintedAt + options.nonceTtlMs })
      return ticket
    },
    exchangeBrowserTicket: (ticket) => {
      const digest = secretDigest(ticket)
      const browserTicket = browserTickets.get(digest)
      browserTickets.delete(digest)
      if (!browserTicket || browserTicket.expiresAt <= options.now()) {
        return { accepted: false }
      }
      const sessionToken = randomSecret()
      clientSessions.set(secretDigest(sessionToken), {
        csrfToken: randomSecret(),
        rendererBuildId: options.rendererBuildId,
        serverInstanceId: options.serverInstanceId
      })
      return { accepted: true, sessionToken }
    },
    findSession: (sessionToken) => clientSessions.get(secretDigest(sessionToken))
  }
}
