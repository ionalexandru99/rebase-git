import { Schema } from 'effect4'
import { Rpc, RpcGroup } from 'effect4/unstable/rpc'
import { AgentObservationSchema } from './observe-agent'
import {
  AgentProtocolMismatch,
  AgentProtocolVersionSchema,
  OpenAgentSessionSuccessSchema
} from './open-agent-session'
import {
  AgentOperationIdSchema,
  StopAgentExpectedStateSchema,
  StopAgentResultSchema
} from './stop-agent'

export const AGENT_RPC_PATH = '/rpc/'

const AgentIdentifierSchema = Schema.String.check(Schema.isLengthBetween(1, 128))

export class AgentHandshakeRequired extends Schema.TaggedError<AgentHandshakeRequired>()(
  'AgentHandshakeRequired',
  {}
) {}

export class AgentShuttingDown extends Schema.TaggedError<AgentShuttingDown>()(
  'AgentShuttingDown',
  {}
) {}

export const OpenAgentSession = Rpc.make('openAgentSession', {
  payload: { agentProtocol: AgentProtocolVersionSchema },
  success: OpenAgentSessionSuccessSchema,
  error: Schema.Union([AgentProtocolMismatch, AgentShuttingDown])
})

export const PingAgent = Rpc.make('pingAgent', {
  payload: { requestId: AgentIdentifierSchema },
  success: Schema.Struct({
    requestId: AgentIdentifierSchema,
    sequence: Schema.Int.check(Schema.isGreaterThan(0))
  }),
  error: Schema.Union([AgentHandshakeRequired, AgentShuttingDown])
})

export const ObserveAgent = Rpc.make('observeAgent', {
  payload: {
    afterSequence: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
  },
  success: AgentObservationSchema,
  error: Schema.Union([AgentHandshakeRequired, AgentShuttingDown]),
  stream: true
})

export const StopAgent = Rpc.make('stopAgent', {
  payload: {
    operationId: AgentOperationIdSchema,
    expectedState: StopAgentExpectedStateSchema
  },
  success: StopAgentResultSchema,
  error: Schema.Union([AgentHandshakeRequired, AgentShuttingDown])
})

export const AgentRpcs = RpcGroup.make(OpenAgentSession, PingAgent, ObserveAgent, StopAgent)

export type AgentRpc = RpcGroup.Rpcs<typeof AgentRpcs>
