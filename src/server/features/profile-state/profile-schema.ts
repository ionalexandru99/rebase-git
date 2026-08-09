import {
  type EnvironmentId,
  EnvironmentIdSchema,
  type EnvironmentPathRef,
  EnvironmentPathRefSchema,
  type RepoRef,
  RepoRefSchema
} from '@common/features/repository-identity'
import { Schema } from 'effect4'

export const CURRENT_DATA_SCHEMA = 2 as const

export interface StoredEnvironmentDefinition {
  readonly id: EnvironmentId
  readonly kind: 'local'
  readonly name: string
}

export interface ProfileSettings {
  readonly onboardingComplete: boolean
  readonly sidebarOpen: boolean
  readonly sidebarWidth: number
  readonly reopenRepositoriesOnLaunch: boolean
  readonly pullDivergedStrategy: 'rebase' | 'merge' | null
  readonly updateDownloadInBackground: boolean
  readonly updateInstallOnQuit: boolean
  readonly updateChannel: 'stable' | 'nightly' | null
}

export interface RepositoryPreferences {
  readonly repository: RepoRef
  readonly listPaneWidth?: number
  readonly refTreeToggles: readonly string[]
}

export interface ServerProfileState {
  readonly dataSchema: typeof CURRENT_DATA_SCHEMA
  readonly environments: readonly StoredEnvironmentDefinition[]
  readonly workspaces: readonly EnvironmentPathRef[]
  readonly activeWorkspace: EnvironmentPathRef | null
  readonly recents: readonly RepoRef[]
  readonly tabs: readonly (RepoRef | null)[]
  readonly activeTabIndex: number
  readonly settings: ProfileSettings
  readonly repositoryPreferences: Readonly<Record<string, RepositoryPreferences>>
}

export function repositoryPreferenceKey(repository: RepoRef): string {
  return JSON.stringify([repository.environmentId, repository.path])
}

const StoredEnvironmentDefinitionSchema = Schema.Struct({
  id: EnvironmentIdSchema,
  kind: Schema.Literal('local'),
  name: Schema.String
})

const ProfileSettingsSchema = Schema.Struct({
  onboardingComplete: Schema.Boolean,
  sidebarOpen: Schema.Boolean,
  sidebarWidth: Schema.Number,
  reopenRepositoriesOnLaunch: Schema.Boolean,
  pullDivergedStrategy: Schema.Union([
    Schema.Literal('rebase'),
    Schema.Literal('merge'),
    Schema.Null
  ]),
  updateDownloadInBackground: Schema.Boolean,
  updateInstallOnQuit: Schema.Boolean,
  updateChannel: Schema.Union([Schema.Literal('stable'), Schema.Literal('nightly'), Schema.Null])
})

const RepositoryPreferencesSchema = Schema.Struct({
  repository: RepoRefSchema,
  listPaneWidth: Schema.optionalKey(Schema.Number),
  refTreeToggles: Schema.Array(Schema.String)
})

export const ServerProfileStateSchema = Schema.Struct({
  dataSchema: Schema.Literal(CURRENT_DATA_SCHEMA),
  environments: Schema.Array(StoredEnvironmentDefinitionSchema),
  workspaces: Schema.Array(EnvironmentPathRefSchema),
  activeWorkspace: Schema.Union([EnvironmentPathRefSchema, Schema.Null]),
  recents: Schema.Array(RepoRefSchema),
  tabs: Schema.Array(Schema.Union([RepoRefSchema, Schema.Null])),
  activeTabIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  settings: ProfileSettingsSchema,
  repositoryPreferences: Schema.Record(Schema.String, RepositoryPreferencesSchema)
})
