import type { GetLocalBranches, GetRemoteRefs, GetStatus, OpenRepo } from '@shared/rpc'
import type { GitStatus, LocalBranches, RemoteRefs, RepoOpenSuccess } from '@shared/schemas/git'
import type { RpcWireResult } from './sidecar-rpc-fake'

export function makeGitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    current: 'main',
    modified: [],
    staged: [],
    not_added: [],
    conflicted: [],
    deleted: [],
    created: [],
    renamed: [],
    files: [],
    ...overrides
  }
}

export function statusResponse(
  overrides: Partial<GitStatus> = {}
): RpcWireResult<typeof GetStatus> {
  return { _tag: 'Ok', status: makeGitStatus(overrides) }
}

export function openedRepoResponse(
  repoPath: string,
  overrides: Partial<RepoOpenSuccess> = {}
): RpcWireResult<typeof OpenRepo> {
  return {
    _tag: 'Ok',
    result: { path: repoPath, remotes: {}, defaultBranch: 'main', ...overrides }
  }
}

export function localBranchesResponse(
  overrides: Partial<LocalBranches> = {}
): RpcWireResult<typeof GetLocalBranches> {
  return {
    _tag: 'Ok',
    branches: { current: 'main', all: ['main'], ...overrides }
  }
}

export function remoteRefsResponse(
  overrides: Partial<RemoteRefs> = {}
): RpcWireResult<typeof GetRemoteRefs> {
  return {
    _tag: 'Ok',
    refs: { remotes: [], tags: [], ...overrides }
  }
}
