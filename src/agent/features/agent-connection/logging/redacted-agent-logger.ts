import { Effect } from 'effect4'

export interface AgentLogger {
  readonly registerSecret: (secret: string) => Effect.Effect<void>
  readonly write: (event: string, fields?: Readonly<Record<string, unknown>>) => Effect.Effect<void>
}

export function makeAgentLogger(maxEntryBytes: number): Effect.Effect<AgentLogger> {
  return Effect.sync(() => {
    const secrets = new Set<string>()

    return {
      registerSecret: (secret) =>
        Effect.sync(() => {
          if (secret.length > 0) {
            secrets.add(secret)
          }
        }),
      write: (event, fields = {}) =>
        Effect.sync(() => {
          let encoded = JSON.stringify({ event, ...fields })
          for (const secret of secrets) {
            encoded = encoded.split(secret).join('[redacted]')
          }
          const bounded = Buffer.from(encoded)
            .subarray(0, maxEntryBytes - 1)
            .toString('utf8')
            .replace(/\uFFFD$/, '')
          process.stderr.write(`${bounded}\n`)
        })
    }
  })
}
