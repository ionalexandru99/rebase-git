import path from 'node:path'
import { Data } from 'effect4'

export type ServerBrowserOpening = 'browser' | 'none'

export interface ServerInvocationOptions {
  readonly path: string
  readonly port: number
  readonly open: ServerBrowserOpening
  readonly readOnly: boolean
}

export type ServerInvocationOptionsFailureReason =
  | 'DuplicateOption'
  | 'InvalidArguments'
  | 'InvalidValue'
  | 'UnknownOption'

export class ServerInvocationOptionsFailure extends Data.TaggedError(
  'ServerInvocationOptionsFailure'
)<{
  readonly reason: ServerInvocationOptionsFailureReason
  readonly message: string
  readonly option?: string
}> {}

export type ServerInvocationOptionsParseResult =
  | {
      readonly _tag: 'Success'
      readonly options: ServerInvocationOptions
    }
  | {
      readonly _tag: 'Failure'
      readonly failure: ServerInvocationOptionsFailure
    }

function failure(
  reason: ServerInvocationOptionsFailureReason,
  message: string,
  option?: string
): ServerInvocationOptionsParseResult {
  return {
    _tag: 'Failure',
    failure: new ServerInvocationOptionsFailure({ reason, message, option })
  }
}

export function parseServerInvocationOptions(
  arguments_: readonly string[],
  currentDirectory: string
): ServerInvocationOptionsParseResult {
  let selectedPath = currentDirectory
  let port = 0
  let open: ServerBrowserOpening = 'browser'
  let readOnly = false
  let hasSelectedPath = false
  let optionsEnded = false
  const seenOptions = new Set<string>()
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--' && !optionsEnded) {
      optionsEnded = true
      continue
    }
    if (
      !optionsEnded &&
      (argument === '--port' || argument === '--open' || argument === '--read-only') &&
      seenOptions.has(argument)
    ) {
      return failure(
        'DuplicateOption',
        `Server option ${argument} was provided more than once`,
        argument
      )
    }
    if (
      !optionsEnded &&
      (argument === '--port' || argument === '--open' || argument === '--read-only')
    ) {
      seenOptions.add(argument)
    }
    if (!optionsEnded && argument === '--read-only') {
      readOnly = true
    } else if (!optionsEnded && argument === '--open') {
      const value = arguments_[index + 1]
      if (value === undefined || value.startsWith('--')) {
        return failure('InvalidArguments', '--open requires a value', '--open')
      }
      if (value !== 'browser' && value !== 'none') {
        return failure('InvalidValue', '--open must be either browser or none', '--open')
      }
      open = value
      index += 1
    } else if (!optionsEnded && argument === '--port') {
      const value = arguments_[index + 1]
      if (value === undefined || value.startsWith('--')) {
        return failure('InvalidArguments', '--port requires a value', '--port')
      }
      port = Number(value)
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        return failure('InvalidValue', '--port must be an integer between 1 and 65535', '--port')
      }
      index += 1
    } else if (!optionsEnded && argument?.startsWith('-')) {
      return failure('UnknownOption', `Unknown Server option ${argument}`, argument)
    } else if (argument !== undefined) {
      if (hasSelectedPath) {
        return failure(
          'InvalidArguments',
          'Server accepts at most one repository or workspace path'
        )
      }
      selectedPath = path.resolve(currentDirectory, argument)
      hasSelectedPath = true
    }
  }
  return {
    _tag: 'Success',
    options: {
      path: selectedPath,
      port,
      open,
      readOnly
    }
  }
}
