import type { Readable } from 'node:stream'
import {
  AGENT_WIRE_DECODE_OPTIONS,
  type AgentReadyRecord,
  AgentReadyRecordSchema
} from '@common/features/agent-connection'
import { Cause, Effect, Exit, Schema } from 'effect4'
import type { AgentProcessExit } from './agent-connection'
import { AgentConnectionFailure, type AgentProcessMonitorError } from './agent-connection-failure'

const MAX_ANNOUNCEMENT_BYTES = 4096

function decodeAnnouncement(line: string): Effect.Effect<AgentReadyRecord, AgentConnectionFailure> {
  return Effect.try({
    try: () => JSON.parse(line) as unknown,
    catch: (detail) =>
      new AgentConnectionFailure({
        reason: 'MalformedReadiness',
        message: 'Agent readiness record is not valid JSON',
        detail
      })
  }).pipe(
    Effect.flatMap((value) => {
      const decoded = Schema.decodeUnknownExit(
        AgentReadyRecordSchema,
        AGENT_WIRE_DECODE_OPTIONS
      )(value)
      return Exit.isFailure(decoded)
        ? Effect.fail(
            new AgentConnectionFailure({
              reason: 'MalformedReadiness',
              message: 'Agent readiness record does not match the Agent interface',
              detail: Cause.pretty(decoded.cause)
            })
          )
        : Effect.succeed(decoded.value)
    })
  )
}

function firstAnnouncementLine(stdout: Readable): Effect.Effect<string, AgentConnectionFailure> {
  return Effect.callback((resume) => {
    let buffered = Buffer.alloc(0)

    const cleanup = () => {
      stdout.off('data', onData)
      stdout.off('end', onEnd)
      stdout.off('error', onError)
    }
    const fail = (failure: AgentConnectionFailure) => {
      cleanup()
      resume(Effect.fail(failure))
    }
    const onData = (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      buffered = Buffer.concat([buffered, bytes])
      if (buffered.length > MAX_ANNOUNCEMENT_BYTES) {
        fail(
          new AgentConnectionFailure({
            reason: 'ReadinessTooLarge',
            message: 'Agent readiness record is too large'
          })
        )
        return
      }
      const newlineIndex = buffered.indexOf(10)
      if (newlineIndex === -1) {
        return
      }
      const remainder = buffered.subarray(newlineIndex + 1)
      if (remainder.length > 0) {
        fail(
          new AgentConnectionFailure({
            reason: 'UnexpectedStdout',
            message: 'Agent wrote to stdout after its readiness record'
          })
        )
        return
      }
      const line = buffered.subarray(0, newlineIndex).toString('utf8')
      cleanup()
      resume(Effect.succeed(line))
    }
    const onEnd = () =>
      fail(
        new AgentConnectionFailure({
          reason: 'MalformedReadiness',
          message: 'Agent stdout ended before its readiness record'
        })
      )
    const onError = (detail: Error) =>
      fail(
        new AgentConnectionFailure({
          reason: 'MalformedReadiness',
          message: 'Agent stdout failed before its readiness record',
          detail
        })
      )

    stdout.on('data', onData)
    stdout.once('end', onEnd)
    stdout.once('error', onError)

    return Effect.sync(cleanup)
  })
}

function exitBeforeAnnouncement(
  agentExited: Effect.Effect<AgentProcessExit, AgentProcessMonitorError>
): Effect.Effect<never, AgentConnectionFailure> {
  return agentExited.pipe(
    Effect.matchEffect({
      onFailure: (detail) =>
        Effect.fail(
          new AgentConnectionFailure({
            reason: 'MonitorFailed',
            message: detail.message,
            detail
          })
        ),
      onSuccess: (exit) =>
        Effect.fail(
          new AgentConnectionFailure({
            reason: 'AgentExited',
            message: `Agent exited before readiness (code ${exit.code}, signal ${exit.signal ?? 'none'})`,
            detail: exit
          })
        )
    })
  )
}

export function readAgentAnnouncement(
  stdout: Readable,
  agentExited: Effect.Effect<AgentProcessExit, AgentProcessMonitorError>,
  timeoutMs: number
): Effect.Effect<AgentReadyRecord, AgentConnectionFailure> {
  return firstAnnouncementLine(stdout).pipe(
    Effect.flatMap(decodeAnnouncement),
    Effect.raceFirst(exitBeforeAnnouncement(agentExited)),
    Effect.timeout(timeoutMs),
    Effect.mapError((error) =>
      Cause.isTimeoutError(error)
        ? new AgentConnectionFailure({
            reason: 'TimedOut',
            message: 'Agent readiness timed out'
          })
        : error
    )
  )
}
