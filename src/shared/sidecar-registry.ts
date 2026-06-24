import { Schema } from 'effect'
import { NonNaNNumber, RequiredString } from './codec'
import {
  BranchesResponseSchema,
  CancelLogStreamResponseSchema,
  GetDiffResponseSchema,
  LocalBranchesResponseSchema,
  LogResponseSchema,
  OpenRepoResponseSchema,
  RemoteRefsResponseSchema,
  ScanForReposResponseSchema,
  StashListResponseSchema,
  StatusResponseSchema
} from './schemas/ipc'
import { SidecarOp, type SidecarOpName } from './sidecar-ops'

const OptionalFlag = Schema.optional(Schema.Boolean)

const RepoOnly = Schema.Struct({ repoPath: RequiredString })

const GetDiffRequest = Schema.Struct({
  repoPath: RequiredString,
  file: RequiredString,
  staged: OptionalFlag
})

const GetLogRequest = Schema.Struct({
  repoPath: RequiredString,
  maxCount: Schema.optional(NonNaNNumber)
})
const ScanRequest = Schema.Struct({ dirPath: RequiredString })

export const sidecarRegistry = {
  [SidecarOp.openRepo]: { request: RepoOnly, response: OpenRepoResponseSchema },
  [SidecarOp.closeRepo]: { request: RepoOnly, response: CancelLogStreamResponseSchema },
  [SidecarOp.getBranches]: { request: RepoOnly, response: BranchesResponseSchema },
  [SidecarOp.getLocalBranches]: { request: RepoOnly, response: LocalBranchesResponseSchema },
  [SidecarOp.getRemoteRefs]: { request: RepoOnly, response: RemoteRefsResponseSchema },
  [SidecarOp.getStatus]: { request: RepoOnly, response: StatusResponseSchema },
  [SidecarOp.getDiff]: { request: GetDiffRequest, response: GetDiffResponseSchema },
  [SidecarOp.getLog]: { request: GetLogRequest, response: LogResponseSchema },
  [SidecarOp.stashList]: { request: RepoOnly, response: StashListResponseSchema },
  [SidecarOp.scanForRepos]: { request: ScanRequest, response: ScanForReposResponseSchema }
}

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
// Compile error if SidecarOp and the registry keys ever diverge — every op must have an entry.
const _everyOpRegistered: AssertEqual<keyof typeof sidecarRegistry, SidecarOpName> = true
void _everyOpRegistered

export type SidecarRequest<Op extends SidecarOpName> =
  (typeof sidecarRegistry)[Op]['request']['Type']
export type SidecarResponse<Op extends SidecarOpName> =
  (typeof sidecarRegistry)[Op]['response']['Type']
