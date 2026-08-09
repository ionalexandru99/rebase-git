import { Schema } from 'effect4'

export const AgentHeartbeatSchema = Schema.Struct({
  _tag: Schema.Literal('Heartbeat'),
  sequence: Schema.Int.check(Schema.isGreaterThan(0))
})

export const AgentRepositoryChangedSchema = Schema.Struct({
  _tag: Schema.Literal('RepositoryChanged'),
  sequence: Schema.Int.check(Schema.isGreaterThan(0)),
  nativePath: Schema.String.check(Schema.isLengthBetween(1, 4096)),
  aspects: Schema.Array(
    Schema.Literals(['references', 'history', 'workingCopy', 'operationState'])
  ).check(Schema.isMinLength(1))
})

export const AgentObservationSchema = Schema.Union([
  AgentHeartbeatSchema,
  AgentRepositoryChangedSchema
])

export type AgentObservation = typeof AgentObservationSchema.Type
