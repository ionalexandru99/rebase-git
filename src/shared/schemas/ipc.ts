import { z } from 'zod'
import {
  CommitSummarySchema,
  GitBranchesSchema,
  GitLogSchema,
  GitStatusSchema,
  RepoOpenSuccessSchema
} from './git'

export const Channel = {
  selectFolder: 'select-folder',
  openRepo: 'open-repo',
  closeRepo: 'close-repo',
  startLogStream: 'start-log-stream',
  cancelLogStream: 'cancel-log-stream',
  scanForRepos: 'scan-for-repos',
  getRecentRepos: 'get-recent-repos',
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
  getSidecarConfig: 'get-sidecar-config',
  logChunk: 'log-chunk',
  repoChanged: 'repo-changed'
} as const

const repoNotOpen = z.object({ _tag: z.literal('RepoNotOpen') })
const gitError = z.object({ _tag: z.literal('GitError'), message: z.string() })

export const StatusResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), status: GitStatusSchema }),
  repoNotOpen,
  gitError
])
export type StatusResponse = z.infer<typeof StatusResponseSchema>

export const BranchesResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), branches: GitBranchesSchema }),
  repoNotOpen,
  gitError
])
export type BranchesResponse = z.infer<typeof BranchesResponseSchema>

export const OpenRepoResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), result: RepoOpenSuccessSchema }),
  z.object({ _tag: z.literal('NotARepo') }),
  gitError
])
export type OpenRepoResponse = z.infer<typeof OpenRepoResponseSchema>

export const LogResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), log: GitLogSchema }),
  repoNotOpen,
  gitError
])
export type LogResponse = z.infer<typeof LogResponseSchema>

export const StageResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  repoNotOpen,
  gitError
])
export type StageResponse = z.infer<typeof StageResponseSchema>

export const UnstageResponseSchema = StageResponseSchema
export type UnstageResponse = z.infer<typeof UnstageResponseSchema>

export const CommitResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), result: CommitSummarySchema }),
  repoNotOpen,
  gitError
])
export type CommitResponse = z.infer<typeof CommitResponseSchema>

export const FetchResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  z.object({ _tag: z.literal('FetchSkipped') }),
  repoNotOpen,
  gitError
])
export type FetchResponse = z.infer<typeof FetchResponseSchema>

export const StartLogStreamResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  gitError
])
export type StartLogStreamResponse = z.infer<typeof StartLogStreamResponseSchema>

export const CancelLogStreamResponseSchema = z.object({})
export type CancelLogStreamResponse = z.infer<typeof CancelLogStreamResponseSchema>

export const ScanForReposResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), repos: z.array(z.string()) }),
  gitError
])
export type ScanForReposResponse = z.infer<typeof ScanForReposResponseSchema>

export const RefKindSchema = z.enum(['local', 'remote', 'tag'])
export type RefKind = z.infer<typeof RefKindSchema>

export const CheckoutResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), checkedOut: z.string() }),
  repoNotOpen,
  gitError
])
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>

export const SidebarPrefsSchema = z.object({
  open: z.boolean(),
  width: z.number()
})
export type SidebarPrefs = z.infer<typeof SidebarPrefsSchema>

export const RefTreeTogglesSchema = z.array(z.string())
export type RefTreeToggles = z.infer<typeof RefTreeTogglesSchema>

export const PersistedTabsSchema = z.object({
  tabs: z.array(z.string().nullable()),
  activeIndex: z.number()
})
export type PersistedTabs = z.infer<typeof PersistedTabsSchema>
