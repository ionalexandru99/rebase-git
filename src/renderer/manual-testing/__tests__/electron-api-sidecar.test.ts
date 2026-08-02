import type { RepoChangedEvent } from '@shared/schemas/git'
import { describe, expect, it, vi } from 'vitest'
import { createManualSidecarRequest } from '../electron-api-sidecar'
import { createManualGitState } from '../electron-api-state'

const workspacePath = '/workspace'
const repoPath = '/workspace/repo'

function createBackend() {
  const state = createManualGitState({}, workspacePath, repoPath)
  const notifyRepoChanged = vi.fn<(kind: RepoChangedEvent['kind']) => void>()
  const request = createManualSidecarRequest(state, { repoPath, notifyRepoChanged })
  return { notifyRepoChanged, request, state }
}

describe('manual sidecar request backend', () => {
  it('rejects requests for a different repository without mutating state', async () => {
    const { notifyRepoChanged, request, state } = createBackend()

    await expect(
      request('stageFile', { repoPath: '/workspace/other', file: 'src/renderer/App.tsx' })
    ).resolves.toEqual({ _tag: 'RepoNotOpen' })

    expect(state.status.modified).toContain('src/renderer/App.tsx')
    expect(notifyRepoChanged).not.toHaveBeenCalled()
  })

  it('maps staging and committing to state transitions and repository events', async () => {
    const { notifyRepoChanged, request, state } = createBackend()

    await request('stageAll', {
      repoPath,
      files: ['src/renderer/App.tsx', 'notes/manual-test.md']
    })
    const result = await request('commit', { repoPath, message: 'Manual backend commit' })

    expect(result).toMatchObject({
      _tag: 'Ok',
      result: { branch: 'main', summary: { changes: 3 } }
    })
    expect(state.commits[0]).toMatchObject({
      message: 'Manual backend commit',
      refs: 'HEAD -> main'
    })
    expect(state.status.staged).toEqual([])
    expect(notifyRepoChanged.mock.calls).toEqual([['index'], ['refs']])
  })

  it('returns a detached status snapshot across the transport seam', async () => {
    const { request, state } = createBackend()
    const response = (await request('getStatus', { repoPath })) as {
      status: { modified: string[] }
    }

    response.status.modified.push('transport-only.txt')

    expect(state.status.modified).toEqual(['src/renderer/App.tsx'])
  })

  it('updates refs through the same typed request entry point', async () => {
    const { notifyRepoChanged, request, state } = createBackend()
    const target = state.commits[2].hash

    await request('createBranch', {
      repoPath,
      name: 'release/manual',
      startPoint: target,
      checkout: true
    })

    expect(state.status.current).toBe('release/manual')
    expect(state.commits[2].refs).toContain('HEAD -> release/manual')
    expect(notifyRepoChanged).toHaveBeenCalledWith('refs')
  })

  it('reports unsupported operations as manual RPC errors', async () => {
    const { request } = createBackend()

    await expect(request('unknownOperation', { repoPath })).resolves.toEqual({
      _tag: 'GitError',
      message: 'Unsupported manual RPC: unknownOperation'
    })
  })
})
