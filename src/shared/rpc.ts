import { Rpc, RpcGroup } from '@effect/rpc'
import { Schema } from 'effect'
import { NonNaNNumber, RequiredString } from './codec'
import {
  FileDiffSchema,
  GitBranchesSchema,
  GitLogSchema,
  GitStatusSchema,
  LocalBranchesSchema,
  RemoteRefsSchema
} from './schemas/git'
import { StashEntrySchema } from './schemas/ipc'

// Tagged errors travel on the RPC error channel (separate from the success value) and serialize
// with the same `_tag`s the renderer's registry response unions already discriminate on.
export class RepoNotOpen extends Schema.TaggedError<RepoNotOpen>()('RepoNotOpen', {}) {}
export class GitError extends Schema.TaggedError<GitError>()('GitError', {
  message: Schema.String
}) {}

const ReadError = Schema.Union(RepoNotOpen, GitError)

export const GetStatus = Rpc.make('getStatus', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ status: GitStatusSchema }),
  error: ReadError
})

export const GetBranches = Rpc.make('getBranches', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ branches: GitBranchesSchema }),
  error: ReadError
})

export const GetLocalBranches = Rpc.make('getLocalBranches', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ branches: LocalBranchesSchema }),
  error: ReadError
})

export const GetRemoteRefs = Rpc.make('getRemoteRefs', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ refs: RemoteRefsSchema }),
  error: ReadError
})

export const GetLog = Rpc.make('getLog', {
  payload: { repoPath: RequiredString, maxCount: Schema.optional(NonNaNNumber) },
  success: Schema.Struct({ log: GitLogSchema }),
  error: ReadError
})

export const GetDiff = Rpc.make('getDiff', {
  payload: {
    repoPath: RequiredString,
    file: RequiredString,
    staged: Schema.optional(Schema.Boolean)
  },
  success: Schema.Struct({ diff: FileDiffSchema }),
  error: ReadError
})

export const StashList = Rpc.make('stashList', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ stashes: Schema.Array(StashEntrySchema) }),
  error: ReadError
})

export const SidecarRpcs = RpcGroup.make(
  GetStatus,
  GetBranches,
  GetLocalBranches,
  GetRemoteRefs,
  GetLog,
  GetDiff,
  StashList
)

// The sidecar HTTP ops (kebab-case) that are served through the RPC group, mapped to their RPC tag.
export const rpcReadOps = {
  'get-status': 'getStatus',
  'get-branches': 'getBranches',
  'get-local-branches': 'getLocalBranches',
  'get-remote-refs': 'getRemoteRefs',
  'get-log': 'getLog',
  'get-diff': 'getDiff',
  'stash-list': 'stashList'
} as const

export type RpcReadOp = keyof typeof rpcReadOps
export type RpcReadTag = (typeof rpcReadOps)[RpcReadOp]
