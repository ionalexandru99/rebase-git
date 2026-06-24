import { Conflict, GitError, HunkNotFound, RepoNotOpen } from '@shared/rpc'
import { Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { classifyExit, isRpcOp, isRpcReadOp, isRpcWriteOp, SidecarRpcError } from '../sidecar-rpc'

const TOKEN = 'super-secret-bearer-token'

describe('RPC op classification', () => {
  it('routes the commit op through the write seam, not the old transport', () => {
    expect(isRpcWriteOp('commit')).toBe(true)
    expect(isRpcReadOp('commit')).toBe(false)
    expect(isRpcOp('commit')).toBe(true)
  })

  it('keeps the read ops on the read seam and rejects unknown ops', () => {
    expect(isRpcReadOp('get-status')).toBe(true)
    expect(isRpcWriteOp('get-status')).toBe(false)
    expect(isRpcOp('get-status')).toBe(true)
    expect(isRpcOp('stage-file')).toBe(false)
  })

  it('routes the migrated staging ops through the write seam by their RPC tag', () => {
    for (const tag of ['stageFile', 'unstageFile', 'stageAll', 'unstageAll', 'discardAll']) {
      expect(isRpcWriteOp(tag)).toBe(true)
      expect(isRpcReadOp(tag)).toBe(false)
      expect(isRpcOp(tag)).toBe(true)
    }
  })

  it('routes the conflictable ops through the write seam by their RPC tag', () => {
    for (const tag of ['mergeBranch', 'revertCommit', 'cherryPick']) {
      expect(isRpcWriteOp(tag)).toBe(true)
      expect(isRpcReadOp(tag)).toBe(false)
      expect(isRpcOp(tag)).toBe(true)
    }
    expect(isRpcOp('merge-branch')).toBe(false)
    expect(isRpcOp('revert-commit')).toBe(false)
    expect(isRpcOp('cherry-pick')).toBe(false)
  })
})

describe('classifyExit (commit write op)', () => {
  it('maps a commit success exit onto Ok with the result payload', () => {
    const result = classifyExit(
      'commit',
      Exit.succeed({
        result: {
          commit: 'abc1234',
          branch: 'main',
          summary: { changes: 1, insertions: 1, deletions: 0 }
        }
      }),
      TOKEN
    )
    expect(result).toEqual({
      _tag: 'Ok',
      result: {
        commit: 'abc1234',
        branch: 'main',
        summary: { changes: 1, insertions: 1, deletions: 0 }
      }
    })
  })

  it('maps a typed RepoNotOpen commit failure onto the RepoNotOpen response', () => {
    expect(classifyExit('commit', Exit.fail(new RepoNotOpen()), TOKEN)).toEqual({
      _tag: 'RepoNotOpen'
    })
  })

  it('throws SidecarRpcError for a transport failure on commit', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const transportFailure = Exit.fail({
      _tag: 'RequestError',
      message: 'connect ECONNREFUSED 127.0.0.1'
    })
    expect(() => classifyExit('commit', transportFailure, TOKEN)).toThrow(SidecarRpcError)
    vi.restoreAllMocks()
  })
})

describe('classifyExit', () => {
  it('maps a success exit onto the Ok response with its payload', () => {
    const result = classifyExit('get-status', Exit.succeed({ status: { current: 'main' } }), TOKEN)
    expect(result).toEqual({ _tag: 'Ok', status: { current: 'main' } })
  })

  it('maps a typed RepoNotOpen failure onto the RepoNotOpen response', () => {
    const result = classifyExit('get-status', Exit.fail(new RepoNotOpen()), TOKEN)
    expect(result).toEqual({ _tag: 'RepoNotOpen' })
  })

  it('maps a typed HunkNotFound failure onto the HunkNotFound response', () => {
    const result = classifyExit('stageHunk', Exit.fail(new HunkNotFound()), TOKEN)
    expect(result).toEqual({ _tag: 'HunkNotFound' })
  })

  it('maps a typed Conflict failure onto the Conflict response with its message', () => {
    const result = classifyExit(
      'mergeBranch',
      Exit.fail(new Conflict({ message: 'merge stopped on conflicts' })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'Conflict', message: 'merge stopped on conflicts' })
  })

  it('scrubs the bearer token out of a domain Conflict message', () => {
    const result = classifyExit(
      'mergeBranch',
      Exit.fail(new Conflict({ message: `conflict (token ${TOKEN})` })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'Conflict', message: 'conflict (token ***)' })
  })

  it('maps a typed GitError failure onto the GitError response', () => {
    const result = classifyExit(
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
    expect(() => classifyExit('get-status', transportFailure, TOKEN)).toThrow(SidecarRpcError)
    vi.restoreAllMocks()
  })

  it('throws SidecarRpcError for an RPC decode / contract-drift failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const decodeFailure = Exit.fail({ _tag: 'ParseError', message: 'Expected string, actual 5' })
    expect(() => classifyExit('get-log', decodeFailure, TOKEN)).toThrow(SidecarRpcError)
    vi.restoreAllMocks()
  })

  it('throws SidecarRpcError for a defect (die), which carries no typed failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => classifyExit('get-status', Exit.die(new Error('boom')), TOKEN)).toThrow(
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
      classifyExit('get-status', leakyFailure, TOKEN)
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
    const result = classifyExit(
      'get-status',
      Exit.fail(new GitError({ message: `remote rejected (token ${TOKEN})` })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'GitError', message: 'remote rejected (token ***)' })
  })

  it('logs the scrubbed cause for diagnosis without surfacing it to the caller', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      classifyExit('get-status', Exit.die(new Error(`died with ${TOKEN}`)), TOKEN)
    ).toThrow(SidecarRpcError)
    expect(errorSpy).toHaveBeenCalled()
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).toContain('***')
    expect(logged).not.toContain(TOKEN)
    vi.restoreAllMocks()
  })
})
