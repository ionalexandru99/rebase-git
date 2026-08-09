import {
  AgentConfigurationFailure,
  parseAgentConfiguration
} from '../../../src/agent/features/agent-connection/configuration'
import { describe, expect, it } from 'vitest'

describe('Agent configuration', () => {
  it('parses supported options as plain data', () => {
    const result = parseAgentConfiguration([
      '--port',
      '4321',
      '--orphan-timeout-ms',
      '5000',
      '--git-termination-grace-ms',
      '75'
    ])

    expect(result._tag).toBe('Success')
    if (result._tag === 'Success') {
      expect(result.configuration).toMatchObject({
        port: 4321,
        orphanTimeoutMs: 5000,
        gitTerminationGraceMs: 75
      })
    }
  })

  it.each([
    {
      arguments_: ['--port'],
      reason: 'InvalidArguments'
    },
    {
      arguments_: ['--port', '1', '--port', '2'],
      reason: 'DuplicateOption'
    },
    {
      arguments_: ['--unknown', '1'],
      reason: 'UnknownOption'
    },
    {
      arguments_: ['--port', 'invalid'],
      reason: 'InvalidValue'
    }
  ] as const)('returns typed $reason failures', ({ arguments_, reason }) => {
    const result = parseAgentConfiguration(arguments_)

    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      expect(result.failure).toBeInstanceOf(AgentConfigurationFailure)
      expect(result.failure.reason).toBe(reason)
    }
  })
})
