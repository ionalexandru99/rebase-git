import { describe, expect, it } from 'vitest'
import {
  classifyAgentCommunicationFailure,
  malformedAgentCommunication
} from '../../../../src/server/features/agent-connection/failure/classify-agent-communication-failure'

describe('Agent communication failure details', () => {
  it('does not retain authenticated transport objects', () => {
    const sessionToken = 'session-secret-that-must-not-survive'
    const transportError = Object.assign(new Error(`request failed with ${sessionToken}`), {
      request: {
        headers: { authorization: `Bearer ${sessionToken}` },
        body: sessionToken
      }
    })

    const failure = classifyAgentCommunicationFailure(transportError, 'Agent ping')
    const serializedFailure = JSON.stringify(failure)

    expect(failure.detail).toEqual({ kind: 'Error' })
    expect(serializedFailure).not.toContain(sessionToken)
    expect(serializedFailure).not.toContain('authorization')
  })

  it('does not retain malformed response bodies', () => {
    const sessionToken = 'malformed-response-session-secret'
    const failure = malformedAgentCommunication(
      { headers: { authorization: `Bearer ${sessionToken}` }, body: sessionToken },
      'Agent observation'
    )

    expect(failure.detail).toEqual({ kind: 'object' })
    expect(JSON.stringify(failure)).not.toContain(sessionToken)
  })
})
