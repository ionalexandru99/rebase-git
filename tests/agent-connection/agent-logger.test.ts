import { Effect } from 'effect4'
import { describe, expect, it, vi } from 'vitest'
import { makeAgentLogger } from '../../src/agent/features/agent-connection/logging/redacted-agent-logger'

describe('Agent stderr logger', () => {
  it('redacts registered secrets before enforcing the byte limit', async () => {
    const writes: string[] = []
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        writes.push(chunk.toString())
        return true
      }) as typeof process.stderr.write)
    const secret = 'authority-secret-value'

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeAgentLogger(128)
          yield* logger.registerSecret(secret)
          yield* logger.write('bounded-entry', {
            credential: secret,
            detail: 'x'.repeat(1_000)
          })
        })
      )
    } finally {
      stderr.mockRestore()
    }

    expect(writes).toHaveLength(1)
    expect(Buffer.byteLength(writes[0]!)).toBeLessThanOrEqual(128)
    expect(writes[0]).not.toContain(secret)
    expect(writes[0]).toContain('[redacted]')
  })
})
