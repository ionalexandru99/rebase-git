import { GitError, RepoNotOpen } from '@shared/rpc'
import { Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { classifyReadExit, SidecarRpcError } from '../sidecar-rpc'

const TOKEN = 'super-secret-bearer-token'

describe('classifyReadExit', () => {
  it('maps a success exit onto the Ok response with its payload', () => {
    const result = classifyReadExit(
      'get-status',
      Exit.succeed({ status: { current: 'main' } }),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'Ok', status: { current: 'main' } })
  })

  it('maps a typed RepoNotOpen failure onto the RepoNotOpen response', () => {
    const result = classifyReadExit('get-status', Exit.fail(new RepoNotOpen()), TOKEN)
    expect(result).toEqual({ _tag: 'RepoNotOpen' })
  })

  it('maps a typed GitError failure onto the GitError response', () => {
    const result = classifyReadExit(
      'get-status',
      Exit.fail(new GitError({ message: 'fatal: not a git repository' })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'GitError', message: 'fatal: not a git repository' })
  })

  it('throws SidecarRpcError for a transport failure instead of collapsing to GitError', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const transportFailure = Exit.fail({
      _tag: 'RequestError',
      message: 'connect ECONNREFUSED 127.0.0.1'
    })
    expect(() => classifyReadExit('get-status', transportFailure, TOKEN)).toThrow(SidecarRpcError)
    vi.restoreAllMocks()
  })

  it('throws SidecarRpcError for an RPC decode / contract-drift failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const decodeFailure = Exit.fail({ _tag: 'ParseError', message: 'Expected string, actual 5' })
    expect(() => classifyReadExit('get-log', decodeFailure, TOKEN)).toThrow(SidecarRpcError)
    vi.restoreAllMocks()
  })

  it('throws SidecarRpcError for a defect (die), which carries no typed failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => classifyReadExit('get-status', Exit.die(new Error('boom')), TOKEN)).toThrow(
      SidecarRpcError
    )
    vi.restoreAllMocks()
  })

  it('does not leak the bearer token in the thrown infrastructure error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const leakyFailure = Exit.fail({
      _tag: 'RequestError',
      message: `GET /rpc failed with authorization: Bearer ${TOKEN}`
    })
    let caught: unknown
    try {
      classifyReadExit('get-status', leakyFailure, TOKEN)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SidecarRpcError)
    expect((caught as Error).message).not.toContain(TOKEN)
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(TOKEN)
    }
    vi.restoreAllMocks()
  })

  it('scrubs the bearer token out of a domain GitError message', () => {
    const result = classifyReadExit(
      'get-status',
      Exit.fail(new GitError({ message: `remote rejected (token ${TOKEN})` })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'GitError', message: 'remote rejected (token ***)' })
  })

  it('logs the scrubbed cause for diagnosis without surfacing it to the caller', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      classifyReadExit('get-status', Exit.die(new Error(`died with ${TOKEN}`)), TOKEN)
    ).toThrow(SidecarRpcError)
    expect(errorSpy).toHaveBeenCalled()
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).toContain('***')
    expect(logged).not.toContain(TOKEN)
    vi.restoreAllMocks()
  })
})
