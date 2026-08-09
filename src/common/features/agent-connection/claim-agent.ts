import { Schema } from 'effect4'

export const AGENT_LOOPBACK_HOST = '127.0.0.1'
export const CLAIM_AGENT_PATH = '/bootstrap'
export const AGENT_SESSION_AUTHORIZATION_SCHEME = 'Bearer'

const AgentPortSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(65_535)
)
const AgentSecretSchema = Schema.String.check(Schema.isLengthBetween(32, 128))

export const AgentReadyRecordSchema = Schema.Struct({
  type: Schema.Literal('ready'),
  port: AgentPortSchema,
  bootstrapSecret: AgentSecretSchema,
  productVersion: Schema.String.check(Schema.isLengthBetween(1, 64)),
  agentProtocol: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  platform: Schema.String.check(Schema.isLengthBetween(1, 64)),
  architecture: Schema.String.check(Schema.isLengthBetween(1, 64))
})

export type AgentReadyRecord = typeof AgentReadyRecordSchema.Type

export const ClaimAgentRequestSchema = Schema.Struct({
  bootstrapSecret: AgentSecretSchema
})

export type ClaimAgentRequest = typeof ClaimAgentRequestSchema.Type

export const ClaimAgentSuccessSchema = Schema.Struct({
  sessionToken: AgentSecretSchema
})

export type ClaimAgentSuccess = typeof ClaimAgentSuccessSchema.Type

export class AgentClaimRejected extends Schema.TaggedError<AgentClaimRejected>()(
  'AgentClaimRejected',
  {
    reason: Schema.Literals(['MalformedRequest', 'InvalidSecret', 'AlreadyClaimed'])
  }
) {}

export const ClaimAgentFailureSchema = AgentClaimRejected
