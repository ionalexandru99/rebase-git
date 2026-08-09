import { timingSafeEqual } from 'node:crypto'
import {
  AGENT_PROTOCOL,
  type AgentObservation,
  type StopAgentResult
} from '@common/features/agent-connection'

interface SessionActivity {
  readonly lastActivityAt: number
  readonly sequence: number
}

export type AgentSessionState =
  | (SessionActivity & {
      readonly _tag: 'AwaitingClaim'
      readonly bootstrapSecret: string
    })
  | (SessionActivity & {
      readonly _tag: 'AwaitingHandshake'
      readonly sessionToken: string
    })
  | (SessionActivity & {
      readonly _tag: 'Running'
      readonly sessionToken: string
    })
  | (SessionActivity & {
      readonly _tag: 'Stopping'
      readonly sessionToken?: string
      readonly stopOperationId?: string
    })
  | (SessionActivity & {
      readonly _tag: 'Stopped'
    })

export type ClaimTransition =
  | { readonly _tag: 'Claimed' }
  | {
      readonly _tag: 'Rejected'
      readonly reason: 'AlreadyClaimed' | 'InvalidSecret'
    }

export type OpenTransition = 'Opened' | 'AlreadyOpen' | 'ShuttingDown'
export type RunningTransition = 'Running' | 'HandshakeRequired' | 'ShuttingDown'
export type StopTransition = AgentStopDecision | 'HandshakeRequired'

export interface AgentStopDecision {
  readonly result: StopAgentResult
  readonly shouldShutdown: boolean
}

type WithoutSequence<Observation> = Observation extends unknown
  ? Omit<Observation, 'sequence'>
  : never

export type AgentObservationDraft = WithoutSequence<AgentObservation>

function secretsEqual(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  )
}

export function initialSessionState(bootstrapSecret: string, startedAt: number): AgentSessionState {
  return {
    _tag: 'AwaitingClaim',
    bootstrapSecret,
    lastActivityAt: startedAt,
    sequence: 0
  }
}

export function claimSession(
  state: AgentSessionState,
  providedSecret: string,
  sessionToken: string,
  now: number
): readonly [ClaimTransition, AgentSessionState] {
  if (state._tag !== 'AwaitingClaim') {
    return [{ _tag: 'Rejected', reason: 'AlreadyClaimed' }, state]
  }
  if (!secretsEqual(providedSecret, state.bootstrapSecret)) {
    return [{ _tag: 'Rejected', reason: 'InvalidSecret' }, state]
  }
  return [
    { _tag: 'Claimed' },
    {
      _tag: 'AwaitingHandshake',
      sessionToken,
      lastActivityAt: now,
      sequence: state.sequence
    }
  ]
}

export function authorizeSession(
  state: AgentSessionState,
  authorization: string,
  expectedAuthorization: (sessionToken: string) => string,
  now: number
): readonly [boolean, AgentSessionState] {
  if (state._tag === 'AwaitingClaim' || state._tag === 'Stopped' || !state.sessionToken) {
    return [false, state]
  }
  const authorized = secretsEqual(authorization, expectedAuthorization(state.sessionToken))
  return [authorized, authorized ? { ...state, lastActivityAt: now } : state]
}

export function openSession(
  state: AgentSessionState,
  now: number
): readonly [OpenTransition, AgentSessionState] {
  if (state._tag === 'AwaitingHandshake') {
    return [
      'Opened',
      {
        _tag: 'Running',
        sessionToken: state.sessionToken,
        lastActivityAt: now,
        sequence: state.sequence
      }
    ]
  }
  if (state._tag === 'Running') {
    return ['AlreadyOpen', { ...state, lastActivityAt: now }]
  }
  return ['ShuttingDown', state]
}

export function requireRunningSession(
  state: AgentSessionState,
  now: number
): readonly [RunningTransition, AgentSessionState] {
  if (state._tag === 'Running') {
    return ['Running', { ...state, lastActivityAt: now }]
  }
  return [state._tag === 'AwaitingHandshake' ? 'HandshakeRequired' : 'ShuttingDown', state]
}

export function advanceObservation(
  state: AgentSessionState,
  observation: AgentObservationDraft
): readonly [AgentObservation | undefined, AgentSessionState] {
  if (state._tag !== 'Running') {
    return [undefined, state]
  }
  const nextSequence = state.sequence + 1
  return [
    { ...observation, sequence: nextSequence },
    { ...state, sequence: nextSequence }
  ]
}

export function touchSession(state: AgentSessionState, now: number): AgentSessionState {
  return { ...state, lastActivityAt: now }
}

export function stopSession(
  state: AgentSessionState,
  operationId: string,
  expectedAgentProtocol: number
): readonly [StopTransition, AgentSessionState] {
  if (state._tag === 'AwaitingHandshake') {
    return ['HandshakeRequired', state]
  }
  if (state._tag === 'Running') {
    if (expectedAgentProtocol !== AGENT_PROTOCOL) {
      return [
        {
          result: {
            _tag: 'PreconditionFailed',
            operationId,
            reason: `expected Agent protocol ${expectedAgentProtocol}, running ${AGENT_PROTOCOL}`
          },
          shouldShutdown: false
        },
        state
      ]
    }
    return [
      { result: { _tag: 'Applied', operationId }, shouldShutdown: true },
      { ...state, _tag: 'Stopping', stopOperationId: operationId }
    ]
  }
  if (state._tag === 'Stopping' && state.stopOperationId === operationId) {
    return [{ result: { _tag: 'Applied', operationId }, shouldShutdown: false }, state]
  }
  return [
    {
      result: {
        _tag: 'PreconditionFailed',
        operationId,
        reason: `expected lifecycle running, running ${state._tag === 'Stopped' ? 'stopped' : 'stopping'}`
      },
      shouldShutdown: false
    },
    state
  ]
}

export function beginSessionShutdown(state: AgentSessionState): AgentSessionState {
  if (state._tag === 'Stopping' || state._tag === 'Stopped') {
    return state
  }
  return {
    _tag: 'Stopping',
    sessionToken: state._tag === 'AwaitingClaim' ? undefined : state.sessionToken,
    lastActivityAt: state.lastActivityAt,
    sequence: state.sequence
  }
}

export function completeSessionShutdown(state: AgentSessionState): AgentSessionState {
  return {
    _tag: 'Stopped',
    lastActivityAt: state.lastActivityAt,
    sequence: state.sequence
  }
}
