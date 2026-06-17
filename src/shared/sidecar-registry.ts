import { Schema } from 'effect'
import {
  BranchesResponseSchema,
  CheckoutResponseSchema,
  CloseRepoResponseSchema,
  CommitResponseSchema,
  ConflictableMutationResponseSchema,
  FetchResponseSchema,
  GetDiffResponseSchema,
  GitMutationResponseSchema,
  LocalBranchesResponseSchema,
  LogResponseSchema,
  OpenRepoResponseSchema,
  PullResponseSchema,
  PushResponseSchema,
  RefKindSchema,
  RemoteRefsResponseSchema,
  ResetModeSchema,
  ScanForReposResponseSchema,
  StageHunkResponseSchema,
  StageResponseSchema,
  StashListResponseSchema,
  StatusResponseSchema,
  UnstageResponseSchema
} from './schemas/ipc'
import { SidecarOp, type SidecarOpName } from './sidecar-ops'

const nonNegativeInteger = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))
const positiveInteger = Schema.Number.pipe(Schema.int(), Schema.positive())

const repoPathRequest = Schema.Struct({ repoPath: Schema.String })
const fileRequest = Schema.Struct({ repoPath: Schema.String, file: Schema.String })
const filesRequest = Schema.Struct({
  repoPath: Schema.String,
  files: Schema.Array(Schema.String)
})
const hunkRequest = Schema.Struct({
  repoPath: Schema.String,
  file: Schema.String,
  hunkHeader: Schema.String
})
const shaRequest = Schema.Struct({ repoPath: Schema.String, sha: Schema.String })
const stashIndexRequest = Schema.Struct({ repoPath: Schema.String, index: nonNegativeInteger })

export const sidecarRegistry = {
  [SidecarOp.openRepo]: {
    request: repoPathRequest,
    response: OpenRepoResponseSchema
  },
  [SidecarOp.closeRepo]: {
    request: repoPathRequest,
    response: CloseRepoResponseSchema
  },
  [SidecarOp.getBranches]: {
    request: repoPathRequest,
    response: BranchesResponseSchema
  },
  [SidecarOp.getLocalBranches]: {
    request: repoPathRequest,
    response: LocalBranchesResponseSchema
  },
  [SidecarOp.getRemoteRefs]: {
    request: repoPathRequest,
    response: RemoteRefsResponseSchema
  },
  [SidecarOp.getStatus]: {
    request: repoPathRequest,
    response: StatusResponseSchema
  },
  [SidecarOp.stageFile]: {
    request: fileRequest,
    response: StageResponseSchema
  },
  [SidecarOp.unstageFile]: {
    request: fileRequest,
    response: UnstageResponseSchema
  },
  [SidecarOp.stageAll]: {
    request: filesRequest,
    response: StageResponseSchema
  },
  [SidecarOp.unstageAll]: {
    request: filesRequest,
    response: UnstageResponseSchema
  },
  [SidecarOp.commit]: {
    request: Schema.Struct({ repoPath: Schema.String, message: Schema.String }),
    response: CommitResponseSchema
  },
  [SidecarOp.getDiff]: {
    request: Schema.Struct({
      repoPath: Schema.String,
      file: Schema.String,
      staged: Schema.optional(Schema.Boolean)
    }),
    response: GetDiffResponseSchema
  },
  [SidecarOp.stageHunk]: {
    request: hunkRequest,
    response: StageHunkResponseSchema
  },
  [SidecarOp.unstageHunk]: {
    request: hunkRequest,
    response: StageHunkResponseSchema
  },
  [SidecarOp.fetchRepo]: {
    request: repoPathRequest,
    response: FetchResponseSchema
  },
  [SidecarOp.pushRepo]: {
    request: repoPathRequest,
    response: PushResponseSchema
  },
  [SidecarOp.pullRepo]: {
    request: repoPathRequest,
    response: PullResponseSchema
  },
  [SidecarOp.getLog]: {
    request: Schema.Struct({ repoPath: Schema.String, maxCount: Schema.optional(positiveInteger) }),
    response: LogResponseSchema
  },
  [SidecarOp.checkoutRef]: {
    request: Schema.Struct({
      repoPath: Schema.String,
      refKind: RefKindSchema,
      fullPath: Schema.String
    }),
    response: CheckoutResponseSchema
  },
  [SidecarOp.createBranch]: {
    request: Schema.Struct({
      repoPath: Schema.String,
      name: Schema.String,
      startPoint: Schema.optional(Schema.String),
      checkout: Schema.optional(Schema.Boolean)
    }),
    response: GitMutationResponseSchema
  },
  [SidecarOp.deleteBranch]: {
    request: Schema.Struct({
      repoPath: Schema.String,
      name: Schema.String,
      force: Schema.optional(Schema.Boolean)
    }),
    response: GitMutationResponseSchema
  },
  [SidecarOp.renameBranch]: {
    request: Schema.Struct({
      repoPath: Schema.String,
      oldName: Schema.String,
      newName: Schema.String
    }),
    response: GitMutationResponseSchema
  },
  [SidecarOp.mergeBranch]: {
    request: Schema.Struct({ repoPath: Schema.String, ref: Schema.String }),
    response: ConflictableMutationResponseSchema
  },
  [SidecarOp.resetToCommit]: {
    request: Schema.Struct({ repoPath: Schema.String, sha: Schema.String, mode: ResetModeSchema }),
    response: GitMutationResponseSchema
  },
  [SidecarOp.revertCommit]: {
    request: shaRequest,
    response: ConflictableMutationResponseSchema
  },
  [SidecarOp.cherryPick]: {
    request: shaRequest,
    response: ConflictableMutationResponseSchema
  },
  [SidecarOp.createTag]: {
    request: Schema.Struct({
      repoPath: Schema.String,
      name: Schema.String,
      ref: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String)
    }),
    response: GitMutationResponseSchema
  },
  [SidecarOp.deleteTag]: {
    request: Schema.Struct({ repoPath: Schema.String, name: Schema.String }),
    response: GitMutationResponseSchema
  },
  [SidecarOp.stashList]: {
    request: repoPathRequest,
    response: StashListResponseSchema
  },
  [SidecarOp.stashPush]: {
    request: Schema.Struct({
      repoPath: Schema.String,
      message: Schema.optional(Schema.String),
      includeUntracked: Schema.optional(Schema.Boolean),
      files: Schema.optional(Schema.Array(Schema.String))
    }),
    response: GitMutationResponseSchema
  },
  [SidecarOp.stashApply]: {
    request: stashIndexRequest,
    response: ConflictableMutationResponseSchema
  },
  [SidecarOp.stashPop]: {
    request: stashIndexRequest,
    response: ConflictableMutationResponseSchema
  },
  [SidecarOp.stashDrop]: {
    request: stashIndexRequest,
    response: GitMutationResponseSchema
  },
  [SidecarOp.discardChanges]: {
    request: filesRequest,
    response: GitMutationResponseSchema
  },
  [SidecarOp.discardAll]: {
    request: repoPathRequest,
    response: GitMutationResponseSchema
  },
  [SidecarOp.scanForRepos]: {
    request: Schema.Struct({ dirPath: Schema.String }),
    response: ScanForReposResponseSchema
  }
} as const satisfies Record<
  SidecarOpName,
  { request: Schema.Schema.Any; response: Schema.Schema.Any }
>

type SidecarRegistry = typeof sidecarRegistry

export type SidecarRequest<Op extends SidecarOpName> = Schema.Schema.Type<
  SidecarRegistry[Op]['request']
>
export type SidecarResponse<Op extends SidecarOpName> = Schema.Schema.Type<
  SidecarRegistry[Op]['response']
>

export function getSidecarRequestSchema<Op extends SidecarOpName>(
  op: Op
): SidecarRegistry[Op]['request'] {
  return sidecarRegistry[op].request
}

export function getSidecarResponseSchema<Op extends SidecarOpName>(
  op: Op
): SidecarRegistry[Op]['response'] {
  return sidecarRegistry[op].response
}
