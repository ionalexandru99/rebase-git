import {
  parseServerInvocationOptions,
  ServerInvocationOptionsFailure
} from '../../../src/server/features/server-invocation'

describe('Server invocation options', () => {
  it('uses the current directory, an ephemeral port, and browser opening by default', () => {
    const result = parseServerInvocationOptions([], '/workspaces/rebase')

    expect(result).toEqual({
      _tag: 'Success',
      options: {
        path: '/workspaces/rebase',
        port: 0,
        open: 'browser',
        readOnly: false
      }
    })
  })

  it('accepts one path and all supported options in any order', () => {
    const result = parseServerInvocationOptions(
      ['--read-only', '--open', 'none', '../project', '--port', '4312'],
      '/workspaces/rebase'
    )

    expect(result).toEqual({
      _tag: 'Success',
      options: {
        path: '/workspaces/project',
        port: 4312,
        open: 'none',
        readOnly: true
      }
    })
  })

  it('rejects an unknown option', () => {
    const result = parseServerInvocationOptions(['--listen', '3000'], '/workspaces/rebase')

    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      expect(result.failure).toBeInstanceOf(ServerInvocationOptionsFailure)
      expect(result.failure).toMatchObject({ reason: 'UnknownOption', option: '--listen' })
    }
  })

  it('rejects more than one repository or workspace path', () => {
    const result = parseServerInvocationOptions(['one', 'two'], '/workspaces/rebase')

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'InvalidArguments' }
    })
  })

  it('rejects an option whose value is missing', () => {
    const result = parseServerInvocationOptions(['--port'], '/workspaces/rebase')

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'InvalidArguments', option: '--port' }
    })
  })

  it.each(['0', '65536', '2.5', 'not-a-port'])('rejects invalid port %s', (port) => {
    const result = parseServerInvocationOptions(['--port', port], '/workspaces/rebase')

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'InvalidValue', option: '--port' }
    })
  })

  it('rejects an unsupported browser opening mode', () => {
    const result = parseServerInvocationOptions(['--open', 'electron'], '/workspaces/rebase')

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'InvalidValue', option: '--open' }
    })
  })

  it.each([
    ['--port', ['--port', '3000', '--port', '4000']],
    ['--open', ['--open', 'none', '--open', 'browser']],
    ['--read-only', ['--read-only', '--read-only']]
  ])('rejects duplicate %s options', (option, arguments_) => {
    const result = parseServerInvocationOptions(arguments_, '/workspaces/rebase')

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'DuplicateOption', option }
    })
  })

  it('accepts a dash-leading path after the option delimiter', () => {
    const result = parseServerInvocationOptions(['--', '--repository'], '/workspaces/rebase')

    expect(result).toMatchObject({
      _tag: 'Success',
      options: { path: '/workspaces/rebase/--repository' }
    })
  })
})
