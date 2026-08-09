import { Schema } from 'effect4'
import { AgentProtocolVersionSchema } from './open-agent-session'

export const AgentOperationIdSchema = Schema.String.check(Schema.isLengthBetween(1, 128))

export const StopAgentExpectedStateSchema = Schema.Struct({
  agentProtocol: AgentProtocolVersionSchema,
  lifecycle: Schema.Literal('running')
})

export type StopAgentExpectedState = typeof StopAgentExpectedStateSchema.Type

export const AgentStopAppliedSchema = Schema.Struct({
  _tag: Schema.Literal('Applied'),
  operationId: AgentOperationIdSchema
})

export const AgentStopPreconditionFailedSchema = Schema.Struct({
  _tag: Schema.Literal('PreconditionFailed'),
  operationId: AgentOperationIdSchema,
  reason: Schema.String.check(Schema.isLengthBetween(1, 256))
})

export const StopAgentResultSchema = Schema.Union([
  AgentStopAppliedSchema,
  AgentStopPreconditionFailedSchema
])

export type StopAgentResult = typeof StopAgentResultSchema.Type
