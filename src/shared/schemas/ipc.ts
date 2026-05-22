import { Schema } from 'effect'
import { CommitSummary, GitBranches, GitLog, GitStatus, RepoOpenSuccess } from './git'

// IPC channel names. Importing from here on both sides of the bridge guarantees
// main and renderer never drift on channel strings.
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
  logChunk: 'log-chunk',
  repoChanged: 'repo-changed'
} as const

// Tagged error variants shared across IPC responses. Main encodes one of
// these on failure; renderer matches on `_tag` to decide how to react.
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

// Per-channel response envelopes. Each is `Ok` carrying its payload unioned
// with the tagged failures it can produce.
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

// Persisted UI preferences. Stored individually under typed accessors —
// the bridge no longer exposes a generic key/value proxy into electron-store.
export const SidebarPrefs = Schema.Struct({
  open: Schema.Boolean,
  width: Schema.Number
})
export type SidebarPrefs = typeof SidebarPrefs.Type

export const RefTreeToggles = Schema.Array(Schema.String)
export type RefTreeToggles = typeof RefTreeToggles.Type
