import { Data } from 'effect4'

declare const __REBASE_PRODUCT_VERSION__: string

export interface AgentConfiguration {
  readonly allowedRoots: readonly string[]
  readonly port: number
  readonly orphanTimeoutMs: number
  readonly heartbeatIntervalMs: number
  readonly shutdownGraceMs: number
  readonly maxRequestBytes: number
  readonly streamBufferEvents: number
  readonly maxLogEntryBytes: number
  readonly gitTerminationGraceMs: number
}

export type AgentConfigurationFailureReason =
  | 'DuplicateOption'
  | 'InvalidArguments'
  | 'InvalidValue'
  | 'UnknownOption'

export class AgentConfigurationFailure extends Data.TaggedError('AgentConfigurationFailure')<{
  readonly reason: AgentConfigurationFailureReason
  readonly message: string
  readonly option?: string
}> {}

export type AgentConfigurationParseResult =
  | {
      readonly _tag: 'Success'
      readonly configuration: AgentConfiguration
    }
  | {
      readonly _tag: 'Failure'
      readonly failure: AgentConfigurationFailure
    }

export const AGENT_PRODUCT_VERSION =
  typeof __REBASE_PRODUCT_VERSION__ === 'string' ? __REBASE_PRODUCT_VERSION__ : '0.0.2'

const defaultConfiguration: AgentConfiguration = {
  allowedRoots: [],
  port: 0,
  orphanTimeoutMs: 60_000,
  heartbeatIntervalMs: 1_000,
  shutdownGraceMs: 2_000,
  maxRequestBytes: 64 * 1024,
  streamBufferEvents: 64,
  maxLogEntryBytes: 8 * 1024,
  gitTerminationGraceMs: 500
}

function parseInteger(
  option: string,
  value: string,
  minimum: number,
  maximum: number
): number | AgentConfigurationFailure {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : new AgentConfigurationFailure({
        reason: 'InvalidValue',
        option,
        message: `${option} must be an integer between ${minimum} and ${maximum}`
      })
}

export function parseAgentConfiguration(
  arguments_: readonly string[]
): AgentConfigurationParseResult {
  const values = new Map<string, string>()
  const allowedRoots: string[] = []
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index]
    const value = arguments_[index + 1]
    if (!option?.startsWith('--') || value === undefined) {
      return {
        _tag: 'Failure',
        failure: new AgentConfigurationFailure({
          reason: 'InvalidArguments',
          message: 'Agent options must be name-value pairs'
        })
      }
    }
    if (option === '--allowed-root') {
      if (value.length === 0) {
        return {
          _tag: 'Failure',
          failure: new AgentConfigurationFailure({
            reason: 'InvalidValue',
            option,
            message: '--allowed-root must not be empty'
          })
        }
      }
      allowedRoots.push(value)
      continue
    }
    if (values.has(option)) {
      return {
        _tag: 'Failure',
        failure: new AgentConfigurationFailure({
          reason: 'DuplicateOption',
          option,
          message: `Agent option ${option} was provided more than once`
        })
      }
    }
    values.set(option, value)
  }

  const options = {
    '--port': ['port', 0, 65_535],
    '--orphan-timeout-ms': ['orphanTimeoutMs', 1, Number.MAX_SAFE_INTEGER],
    '--heartbeat-interval-ms': ['heartbeatIntervalMs', 1, Number.MAX_SAFE_INTEGER],
    '--shutdown-grace-ms': ['shutdownGraceMs', 1, Number.MAX_SAFE_INTEGER],
    '--git-termination-grace-ms': ['gitTerminationGraceMs', 1, Number.MAX_SAFE_INTEGER]
  } as const
  const configuration = { ...defaultConfiguration, allowedRoots }
  for (const [option, value] of values) {
    const definition = options[option as keyof typeof options]
    if (!definition) {
      return {
        _tag: 'Failure',
        failure: new AgentConfigurationFailure({
          reason: 'UnknownOption',
          option,
          message: `Unknown Agent option ${option}`
        })
      }
    }
    const [property, minimum, maximum] = definition
    const parsed = parseInteger(option, value, minimum, maximum)
    if (parsed instanceof AgentConfigurationFailure) {
      return { _tag: 'Failure', failure: parsed }
    }
    configuration[property] = parsed
  }
  if (allowedRoots.length === 0) {
    return {
      _tag: 'Failure',
      failure: new AgentConfigurationFailure({
        reason: 'InvalidArguments',
        option: '--allowed-root',
        message: 'Agent requires at least one --allowed-root'
      })
    }
  }
  return { _tag: 'Success', configuration }
}
