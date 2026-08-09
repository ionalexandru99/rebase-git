import { PassThrough } from 'node:stream'
import { Effect } from 'effect4'
import { describe, expect, it } from 'vitest'
import {
  AgentConnectionFailure,
  readAgentAnnouncement
} from '../../src/server/features/agent-connection'

const readyRecord = {
  type: 'ready',
  port: 4123,
  bootstrapSecret: 's'.repeat(32),
  productVersion: '0.0.2',
  agentProtocol: 1,
  platform: 'linux',
  architecture: 'x64'
} as const

describe('Agent announcement', () => {
  it('decodes one strict readiness record', async () => {
    const stdout = new PassThrough()
    setImmediate(() => stdout.write(`${JSON.stringify(readyRecord)}\n`))

    const ready = await Effect.runPromise(
      readAgentAnnouncement(stdout, Effect.never, 1_000)
    )

    expect(ready).toEqual(readyRecord)
    stdout.destroy()
  })

  it('rejects additional stdout in the readiness chunk', async () => {
    const stdout = new PassThrough()
    setImmediate(() => stdout.write(`${JSON.stringify(readyRecord)}\nunexpected`))

    const failure = await Effect.runPromise(
      readAgentAnnouncement(stdout, Effect.never, 1_000).pipe(Effect.flip)
    )

    expect(failure).toBeInstanceOf(AgentConnectionFailure)
    expect(failure.reason).toBe('UnexpectedStdout')
    stdout.destroy()
  })

  it('reports process exit before readiness', async () => {
    const stdout = new PassThrough()

    const failure = await Effect.runPromise(
      readAgentAnnouncement(
        stdout,
        Effect.succeed({ code: 7, signal: null }),
        1_000
      ).pipe(Effect.flip)
    )

    expect(failure.reason).toBe('AgentExited')
    stdout.destroy()
  })

  it('times out without leaking stdout listeners', async () => {
    const stdout = new PassThrough()

    const failure = await Effect.runPromise(
      readAgentAnnouncement(stdout, Effect.never, 10).pipe(Effect.flip)
    )

    expect(failure.reason).toBe('TimedOut')
    expect(stdout.listenerCount('data')).toBe(0)
    stdout.destroy()
  })
})
