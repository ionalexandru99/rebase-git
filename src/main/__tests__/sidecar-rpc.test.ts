import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  AmendRejected,
  Conflict,
  FetchSkipped,
  GitError,
  HunkNotFound,
  OperationInProgress,
  PushRejected,
  RepoNotOpen
} from '@shared/rpc'
import { Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  callRpcByTag,
  classifyExit,
  isRendererRpcOp,
  isRpcOp,
  SidecarRpcError
} from '../sidecar-rpc'

const TOKEN = 'super-secret-bearer-token'

describe('RPC op classification', () => {
  it('accepts write RPC tags', () => {
    expect(isRpcOp('commit')).toBe(true)
    expect(isRpcOp('stageFile')).toBe(true)
    expect(isRpcOp('mergeBranch')).toBe(true)
    expect(isRpcOp('stashPush')).toBe(true)
  })

  it('accepts read RPC tags', () => {
    expect(isRpcOp('getStatus')).toBe(true)
    expect(isRpcOp('getLocalBranches')).toBe(true)
    expect(isRpcOp('getRemoteRefs')).toBe(true)
    expect(isRpcOp('stashList')).toBe(true)
  })

  it('rejects obsolete aggregate and unbounded read RPC tags', () => {
    expect(isRpcOp('getBranches')).toBe(false)
    expect(isRpcOp('getLog')).toBe(false)
  })

  it('rejects deleted legacy op names', () => {
    expect(isRpcOp('get-status')).toBe(false)
    expect(isRpcOp('stage-file')).toBe(false)
    expect(isRpcOp('merge-branch')).toBe(false)
    expect(isRpcOp('revert-commit')).toBe(false)
    expect(isRpcOp('cherry-pick')).toBe(false)
    for (const legacy of [
      'fetch-repo',
      'push-repo',
      'pull-repo',
      'reset-to-commit',
      'stash-push',
      'stash-apply',
      'stash-pop',
      'stash-drop'
    ]) {
      expect(isRpcOp(legacy)).toBe(false)
    }
  })

  it('keeps lifecycle RPCs off the generic renderer channel', () => {
    expect(isRendererRpcOp('openRepo')).toBe(false)
    expect(isRendererRpcOp('closeRepo')).toBe(false)
    expect(isRendererRpcOp('streamLog')).toBe(false)
    expect(isRendererRpcOp('scanForRepos')).toBe(false)
    expect(isRendererRpcOp('getStatus')).toBe(true)
    expect(isRendererRpcOp('commit')).toBe(true)
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
    const result = classifyExit('getStatus', Exit.succeed({ status: { current: 'main' } }), TOKEN)
    expect(result).toEqual({ _tag: 'Ok', status: { current: 'main' } })
  })

  it('maps a typed RepoNotOpen failure onto the RepoNotOpen response', () => {
    const result = classifyExit('getStatus', Exit.fail(new RepoNotOpen()), TOKEN)
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

  it('rejects a domain error that is not declared by the requested RPC', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      classifyExit(
        'commit',
        Exit.fail(new Conflict({ message: 'commit cannot return a conflict' })),
        TOKEN
      )
    ).toThrow(SidecarRpcError)
    vi.restoreAllMocks()
  })

  it('scrubs the bearer token out of a domain Conflict message', () => {
    const result = classifyExit(
      'mergeBranch',
      Exit.fail(new Conflict({ message: `conflict (token ${TOKEN})` })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'Conflict', message: 'conflict (token ***)' })
  })

  it('maps a typed FetchSkipped failure onto the FetchSkipped response with no message', () => {
    const result = classifyExit('fetch', Exit.fail(new FetchSkipped()), TOKEN)
    expect(result).toEqual({ _tag: 'FetchSkipped' })
  })

  it('maps a typed GitError failure onto the GitError response', () => {
    const result = classifyExit(
      'getStatus',
      Exit.fail(new GitError({ message: 'fatal: not a git repository' })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'GitError', message: 'fatal: not a git repository' })
  })

  it('maps a typed PushRejected failure onto the PushRejected response with its loss preview', () => {
    const result = classifyExit(
      'push',
      Exit.fail(
        new PushRejected({
          reason: 'lease-stale',
          lostCommits: [{ sha: 'abc1234', subject: 'teammate work' }],
          remoteSha: 'abc1234fullsha'
        })
      ),
      TOKEN
    )
    expect(result).toEqual({
      _tag: 'PushRejected',
      reason: 'lease-stale',
      lostCommits: [{ sha: 'abc1234', subject: 'teammate work' }],
      remoteSha: 'abc1234fullsha'
    })
  })

  it('maps a typed AmendRejected failure onto the AmendRejected response', () => {
    const result = classifyExit(
      'amendCommit',
      Exit.fail(new AmendRejected({ reason: 'head-moved' })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'AmendRejected', reason: 'head-moved' })
  })

  it('maps a typed OperationInProgress failure onto the OperationInProgress response', () => {
    const result = classifyExit(
      'amendCommit',
      Exit.fail(new OperationInProgress({ operation: 'merge' })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'OperationInProgress', operation: 'merge' })
  })

  it('throws SidecarRpcError for a transport failure instead of collapsing to GitError', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const transportFailure = Exit.fail({
      _tag: 'RequestError',
      message: 'connect ECONNREFUSED 127.0.0.1'
    })
    expect(() => classifyExit('getStatus', transportFailure, TOKEN)).toThrow(SidecarRpcError)
    vi.restoreAllMocks()
  })

  it('throws SidecarRpcError for an RPC decode / contract-drift failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const decodeFailure = Exit.fail({ _tag: 'ParseError', message: 'Expected string, actual 5' })
    expect(() => classifyExit('streamLog', decodeFailure, TOKEN)).toThrow(SidecarRpcError)
    vi.restoreAllMocks()
  })

  it('throws SidecarRpcError for a defect (die), which carries no typed failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => classifyExit('getStatus', Exit.die(new Error('boom')), TOKEN)).toThrow(
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
      classifyExit('getStatus', leakyFailure, TOKEN)
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
      'getStatus',
      Exit.fail(new GitError({ message: `remote rejected (token ${TOKEN})` })),
      TOKEN
    )
    expect(result).toEqual({ _tag: 'GitError', message: 'remote rejected (token ***)' })
  })

  it('logs the scrubbed cause for diagnosis without surfacing it to the caller', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      classifyExit('getStatus', Exit.die(new Error(`died with ${TOKEN}`)), TOKEN)
    ).toThrow(SidecarRpcError)
    expect(errorSpy).toHaveBeenCalled()
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).toContain('***')
    expect(logged).not.toContain(TOKEN)
    vi.restoreAllMocks()
  })
})

describe('callRpcByTag transport lifetime', () => {
  it('aborts a stalled HTTP request when its transport timeout expires', async () => {
    let resolveClosed: () => void = () => {}
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    const server = createServer()
    server.on('connection', (socket) => socket.once('close', resolveClosed))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const call = callRpcByTag(
      'getStatus',
      `http://127.0.0.1:${port}`,
      TOKEN,
      { repoPath: '/repo' },
      { timeoutMs: 25 }
    ).then(
      () => 'resolved' as const,
      (error: unknown) => error
    )

    try {
      const outcome = await Promise.race([
        call,
        new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 200))
      ])
      expect(outcome).toBeInstanceOf(SidecarRpcError)
      await closed
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('closes a non-stream HTTP request when its owner cancels', async () => {
    let resolveStarted: () => void = () => {}
    let resolveClosed: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    const server = createServer(() => {
      resolveStarted()
    })
    server.on('connection', (socket) => socket.once('close', resolveClosed))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const controller = new AbortController()
    const call = callRpcByTag(
      'getStatus',
      `http://127.0.0.1:${port}`,
      TOKEN,
      { repoPath: '/repo' },
      { signal: controller.signal, timeoutMs: 1000 }
    )

    try {
      await started
      controller.abort()
      await expect(call).rejects.toBeInstanceOf(SidecarRpcError)
      await closed
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
