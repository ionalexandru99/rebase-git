import {
  AGENT_PROTOCOL,
  AgentRpcs,
  OpenAgentSessionSuccessSchema
} from '../../../src/common/features/agent-connection'
import { Context, Effect, Schema } from 'effect4'
import { describe, expect, it } from 'vitest'

describe('Agent session response', () => {
  it('encodes runtime compatibility as JSON', () => {
    const compatibility = {
      productVersion: '0.0.2',
      agentProtocol: AGENT_PROTOCOL,
      platform: 'linux',
      architecture: 'x64',
      git: { discovered: true as const, executable: 'git' as const, version: '2.0.0' },
      limits: {
        maxRequestBytes: 65_536,
        streamBufferEvents: 64,
        orphanTimeoutMs: 5_000
      }
    }

    expect(
      Schema.encodeUnknownSync(Schema.toCodecJson(OpenAgentSessionSuccessSchema))(compatibility)
    ).toEqual(compatibility)
  })

  it('decodes an open-session JSON payload', () => {
    const payloadSchema = AgentRpcs.requests.get('openAgentSession')?.payloadSchema
    expect(payloadSchema).toBeDefined()
    expect(
      Schema.decodeUnknownSync(Schema.toCodecJson(payloadSchema!))({ agentProtocol: 1 })
    ).toEqual({ agentProtocol: 1 })
  })

  it('decodes an open-session JSON payload with an explicit context', async () => {
    const payloadSchema = AgentRpcs.requests.get('openAgentSession')?.payloadSchema
    const decoded = Schema.decodeUnknownEffect(Schema.toCodecJson(payloadSchema!))({
      agentProtocol: 1
    }).pipe(Effect.provideContext(Context.empty()))

    await expect(Effect.runPromise(decoded)).resolves.toEqual({ agentProtocol: 1 })
  })
})
