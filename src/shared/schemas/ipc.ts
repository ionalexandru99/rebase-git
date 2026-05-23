import { Schema } from 'effect'
import { CommitSummary, GitBranches, GitLog, GitStatus, RepoOpenSuccess } from './git'

export const Channel = {
  selectFolder: 'select-folder',
  openRepo: 'open-repo',
  closeRepo: 'close-repo',
  getBranches: 'get-branches',
  getStatus: 'get-status',
  stageFile: 'stage-file',
  unstageFile: 'unstage-file',
  commit: 'commit',
  fetchRepo: 'git-fetch',
  getLog: 'get-log',
  startLogStream: 'start-log-stream',
  cancelLogStream: 'cancel-log-stream',
  scanForRepos: 'scan-for-repos',
  getRecentRepos: 'get-recent-repos',
  getWorkingDirectory: 'get-working-directory',
  setWorkingDirectory: 'set-working-directory',
  getWorkspaces: 'get-workspaces',
  addWorkspace: 'add-workspace',
  removeWorkspace: 'remove-workspace',
  getActiveWorkspace: 'get-active-workspace',
  setActiveWorkspace: 'set-active-workspace',
  getOnboardingComplete: 'get-onboarding-complete',
  setOnboardingComplete: 'set-onboarding-complete',
  getSidebarPrefs: 'get-sidebar-prefs',
  setSidebarPrefs: 'set-sidebar-prefs',
  getRefTreeToggles: 'get-ref-tree-toggles',
  setRefTreeToggles: 'set-ref-tree-toggles',
  getPersistedTabs: 'get-persisted-tabs',
  setPersistedTabs: 'set-persisted-tabs',
  checkoutRef: 'checkout-ref',
  logChunk: 'log-chunk',
  repoChanged: 'repo-changed'
} as const

export const RepoNotOpen = Schema.TaggedStruct('RepoNotOpen', {})
export type RepoNotOpen = typeof RepoNotOpen.Type

export const GitError = Schema.TaggedStruct('GitError', {
  message: Schema.String
})
export type GitError = typeof GitError.Type

export const FetchSkipped = Schema.TaggedStruct('FetchSkipped', {})
export type FetchSkipped = typeof FetchSkipped.Type

export const NotARepo = Schema.TaggedStruct('NotARepo', {})
export type NotARepo = typeof NotARepo.Type

export const StatusResponse = Schema.Union(
  Schema.TaggedStruct('Ok', { status: GitStatus }),
  RepoNotOpen,
  GitError
)
export type StatusResponse = typeof StatusResponse.Type

export const BranchesResponse = Schema.Union(
  Schema.TaggedStruct('Ok', { branches: GitBranches }),
  RepoNotOpen,
  GitError
)
export type BranchesResponse = typeof BranchesResponse.Type

export const OpenRepoResponse = Schema.Union(
  Schema.TaggedStruct('Ok', { result: RepoOpenSuccess }),
  NotARepo,
  GitError
)
export type OpenRepoResponse = typeof OpenRepoResponse.Type

export const LogResponse = Schema.Union(
  Schema.TaggedStruct('Ok', { log: GitLog }),
  RepoNotOpen,
  GitError
)
export type LogResponse = typeof LogResponse.Type

export const StageResponse = Schema.Union(Schema.TaggedStruct('Ok', {}), RepoNotOpen, GitError)
export type StageResponse = typeof StageResponse.Type

export const UnstageResponse = StageResponse
export type UnstageResponse = StageResponse

export const CommitResponse = Schema.Union(
  Schema.TaggedStruct('Ok', { result: CommitSummary }),
  RepoNotOpen,
  GitError
)
export type CommitResponse = typeof CommitResponse.Type

export const FetchResponse = Schema.Union(
  Schema.TaggedStruct('Ok', {}),
  FetchSkipped,
  RepoNotOpen,
  GitError
)
export type FetchResponse = typeof FetchResponse.Type

export const StartLogStreamResponse = Schema.Union(Schema.TaggedStruct('Ok', {}), GitError)
export type StartLogStreamResponse = typeof StartLogStreamResponse.Type

export const CancelLogStreamResponse = Schema.Struct({})
export type CancelLogStreamResponse = typeof CancelLogStreamResponse.Type

export const ScanForReposResponse = Schema.Union(
  Schema.TaggedStruct('Ok', { repos: Schema.Array(Schema.String) }),
  GitError
)
export type ScanForReposResponse = typeof ScanForReposResponse.Type

export const RefKindSchema = Schema.Literal('local', 'remote', 'tag')
export type RefKindSchema = typeof RefKindSchema.Type

export const CheckoutResponse = Schema.Union(
  Schema.TaggedStruct('Ok', { checkedOut: Schema.String }),
  RepoNotOpen,
  GitError
)
export type CheckoutResponse = typeof CheckoutResponse.Type

export const SidebarPrefs = Schema.Struct({
  open: Schema.Boolean,
  width: Schema.Number
})
export type SidebarPrefs = typeof SidebarPrefs.Type

export const RefTreeToggles = Schema.Array(Schema.String)
export type RefTreeToggles = typeof RefTreeToggles.Type

export const PersistedTabs = Schema.mutable(
  Schema.Struct({
    tabs: Schema.mutable(Schema.Array(Schema.NullOr(Schema.String))),
    activeIndex: Schema.Number
  })
)
export type PersistedTabs = typeof PersistedTabs.Type
