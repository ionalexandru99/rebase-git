import { Schema } from 'effect4'

export const AGENT_PROTOCOL = 2
export const AgentProtocolVersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export class AgentProtocolMismatch extends Schema.TaggedError<AgentProtocolMismatch>()(
  'AgentProtocolMismatch',
  {
    expected: AgentProtocolVersionSchema,
    received: AgentProtocolVersionSchema
  }
) {}

export const AgentGitDiscoveredSchema = Schema.Struct({
  discovered: Schema.Literal(true),
  executable: Schema.Literal('git'),
  version: Schema.String.check(Schema.isLengthBetween(1, 128))
})

export const AgentGitUnavailableSchema = Schema.Struct({
  discovered: Schema.Literal(false),
  executable: Schema.Literal('git')
})

export const AgentGitDiscoverySchema = Schema.Union([
  AgentGitDiscoveredSchema,
  AgentGitUnavailableSchema
])

export const AgentLimitsSchema = Schema.Struct({
  maxRequestBytes: Schema.Int.check(Schema.isGreaterThan(0)),
  streamBufferEvents: Schema.Int.check(Schema.isGreaterThan(0)),
  orphanTimeoutMs: Schema.Int.check(Schema.isGreaterThan(0))
})

export const OpenAgentSessionSuccessSchema = Schema.Struct({
  productVersion: Schema.String.check(Schema.isLengthBetween(1, 64)),
  agentProtocol: AgentProtocolVersionSchema,
  platform: Schema.String.check(Schema.isLengthBetween(1, 64)),
  architecture: Schema.String.check(Schema.isLengthBetween(1, 64)),
  git: AgentGitDiscoverySchema,
  limits: AgentLimitsSchema
})

export type OpenAgentSessionSuccess = typeof OpenAgentSessionSuccessSchema.Type
