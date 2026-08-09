import { Effect } from 'effect4'
import { describe, expect, it } from 'vitest'
import { makeServerDiagnostics } from '../../../src/server/features/browser-server/diagnostics'

describe('Server diagnostics', () => {
  it('records valid structured lines without registered secrets or browser auth nonces', async () => {
    const writtenLines: string[] = []
    const diagnostics = await Effect.runPromise(
      makeServerDiagnostics({
        maxEntryBytes: 512,
        maxRecentEntries: 4,
        writeLine: (line) => writtenLines.push(line)
      })
    )

    await Effect.runPromise(diagnostics.registerSecret('registered-secret'))
    await Effect.runPromise(
      diagnostics.record('browser-request-rejected', {
        cookie: 'client=registered-secret',
        url: 'http://localhost:4312/auth/browser-url-nonce?source=cli'
      })
    )

    expect(writtenLines).toHaveLength(1)
    expect(writtenLines[0]).toMatch(/\n$/)
    expect(JSON.parse(writtenLines[0])).toEqual({
      event: 'browser-request-rejected',
      cookie: 'client=[redacted]',
      url: 'http://localhost:4312/auth/[redacted]?source=cli'
    })
    expect(writtenLines[0]).not.toContain('registered-secret')
    expect(writtenLines[0]).not.toContain('browser-url-nonce')
    await expect(Effect.runPromise(diagnostics.recentLines)).resolves.toEqual([
      writtenLines[0].trimEnd()
    ])
  })

  it('bounds every JSON line and retains only the most recent configured entries', async () => {
    const writtenLines: string[] = []
    const diagnostics = await Effect.runPromise(
      makeServerDiagnostics({
        maxEntryBytes: 96,
        maxRecentEntries: 2,
        writeLine: (line) => writtenLines.push(line)
      })
    )

    await Effect.runPromise(diagnostics.record('first'))
    await Effect.runPromise(
      diagnostics.record('second', { detail: 'repository failure '.repeat(20) })
    )
    await Effect.runPromise(diagnostics.record('third'))

    expect(writtenLines).toHaveLength(3)
    for (const line of writtenLines) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(96)
      expect(() => JSON.parse(line)).not.toThrow()
    }
    expect(JSON.parse(writtenLines[1])).toEqual({ event: 'second', truncated: true })
    await expect(Effect.runPromise(diagnostics.recentLines)).resolves.toEqual([
      writtenLines[1].trimEnd(),
      writtenLines[2].trimEnd()
    ])
  })

  it('redacts registered secrets containing JSON escape characters', async () => {
    const writtenLines: string[] = []
    const diagnostics = await Effect.runPromise(
      makeServerDiagnostics({
        maxEntryBytes: 256,
        maxRecentEntries: 1,
        writeLine: (line) => writtenLines.push(line)
      })
    )

    await Effect.runPromise(diagnostics.registerSecret('secret"with\\escapes'))
    await Effect.runPromise(diagnostics.registerSecret('"'))
    await Effect.runPromise(diagnostics.registerSecret('['))
    await Effect.runPromise(
      diagnostics.record('credential-rejected', {
        bracketValue: '[',
        shortValue: '"',
        value: 'secret"with\\escapes',
        values: ['public']
      })
    )

    expect(JSON.parse(writtenLines[0])).toEqual({
      event: 'credential-rejected',
      bracketValue: '[redacted]',
      shortValue: '[redacted]',
      value: '[redacted]',
      values: ['public']
    })
  })
})
