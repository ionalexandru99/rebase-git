import {
  type EnvironmentId,
  EnvironmentIdSchema,
  type RepoRef
} from '@common/features/repository-identity'
import { Schema } from 'effect4'
import {
  CURRENT_DATA_SCHEMA,
  repositoryPreferenceKey,
  type ServerProfileState,
  ServerProfileStateSchema
} from './profile-schema'

interface LegacyProfileState {
  readonly recentRepos: readonly string[]
  readonly workspaces: readonly string[]
  readonly activeWorkspace: string | null
  readonly workingDirectory: string | null
  readonly onboardingComplete: boolean
  readonly sidebarOpen: boolean
  readonly sidebarWidth: number
  readonly sidebarRefTreeToggles: readonly string[]
  readonly persistedTabRepoPaths: readonly (string | null)[]
  readonly persistedActiveTabIndex: number
  readonly reopenRepositoriesOnLaunch: boolean
  readonly pullDivergedStrategy: 'rebase' | 'merge' | null
  readonly updateDownloadInBackground: boolean
  readonly updateInstallOnQuit: boolean
  readonly updateChannel: 'stable' | 'nightly' | null
  readonly listPaneWidths: Readonly<Record<string, number>>
}

interface DataSchemaOneState {
  readonly dataSchema: 1
  readonly environments: readonly {
    readonly id: EnvironmentId
    readonly kind: 'local'
    readonly name: string
  }[]
  readonly workspaces: readonly { readonly environmentId: EnvironmentId; readonly path: string }[]
  readonly activeWorkspace: {
    readonly environmentId: EnvironmentId
    readonly path: string
  } | null
  readonly recents: readonly RepoRef[]
  readonly tabs: readonly (RepoRef | null)[]
  readonly activeTabIndex: number
  readonly settings: ServerProfileState['settings']
  readonly listPaneWidths: Readonly<Record<string, number>>
  readonly sidebarRefTreeToggles: readonly string[]
}

const LegacyProfileStateSchema = Schema.Struct({
  recentRepos: Schema.Array(Schema.String),
  workspaces: Schema.Array(Schema.String),
  activeWorkspace: Schema.Union([Schema.String, Schema.Null]),
  workingDirectory: Schema.Union([Schema.String, Schema.Null]),
  onboardingComplete: Schema.Boolean,
  sidebarOpen: Schema.Boolean,
  sidebarWidth: Schema.Number,
  sidebarRefTreeToggles: Schema.Array(Schema.String),
  persistedTabRepoPaths: Schema.Array(Schema.Union([Schema.String, Schema.Null])),
  persistedActiveTabIndex: Schema.Int,
  reopenRepositoriesOnLaunch: Schema.Boolean,
  pullDivergedStrategy: Schema.Union([
    Schema.Literal('rebase'),
    Schema.Literal('merge'),
    Schema.Null
  ]),
  updateDownloadInBackground: Schema.Boolean,
  updateInstallOnQuit: Schema.Boolean,
  updateChannel: Schema.Union([Schema.Literal('stable'), Schema.Literal('nightly'), Schema.Null]),
  listPaneWidths: Schema.Record(Schema.String, Schema.Number)
})

const DataSchemaOneStateSchema = Schema.Struct({
  dataSchema: Schema.Literal(1),
  environments: Schema.Array(
    Schema.Struct({
      id: EnvironmentIdSchema,
      kind: Schema.Literal('local'),
      name: Schema.String
    })
  ),
  workspaces: Schema.Array(
    Schema.Struct({ environmentId: EnvironmentIdSchema, path: Schema.String })
  ),
  activeWorkspace: Schema.Union([
    Schema.Struct({ environmentId: EnvironmentIdSchema, path: Schema.String }),
    Schema.Null
  ]),
  recents: Schema.Array(Schema.Struct({ environmentId: EnvironmentIdSchema, path: Schema.String })),
  tabs: Schema.Array(
    Schema.Union([
      Schema.Struct({ environmentId: EnvironmentIdSchema, path: Schema.String }),
      Schema.Null
    ])
  ),
  activeTabIndex: Schema.Int,
  settings: Schema.Struct({
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
  }),
  listPaneWidths: Schema.Record(Schema.String, Schema.Number),
  sidebarRefTreeToggles: Schema.Array(Schema.String)
})

function qualifyPath(environmentId: EnvironmentId, path: string): RepoRef {
  return { environmentId, path }
}

function migrateLegacyToOne(value: unknown, localEnvironmentId: EnvironmentId): DataSchemaOneState {
  const legacy = Schema.decodeUnknownSync(LegacyProfileStateSchema)(value) as LegacyProfileState
  const workspaces =
    legacy.workspaces.length > 0
      ? legacy.workspaces
      : legacy.workingDirectory
        ? [legacy.workingDirectory]
        : []
  const activeWorkspacePath = legacy.activeWorkspace ?? legacy.workingDirectory
  return {
    dataSchema: 1,
    environments: [{ id: localEnvironmentId, kind: 'local', name: 'Local' }],
    workspaces: workspaces.map((path) => qualifyPath(localEnvironmentId, path)),
    activeWorkspace: activeWorkspacePath
      ? qualifyPath(localEnvironmentId, activeWorkspacePath)
      : null,
    recents: legacy.recentRepos.map((path) => qualifyPath(localEnvironmentId, path)),
    tabs: legacy.persistedTabRepoPaths.map((path) =>
      path === null ? null : qualifyPath(localEnvironmentId, path)
    ),
    activeTabIndex: Math.max(0, legacy.persistedActiveTabIndex),
    settings: {
      onboardingComplete: legacy.onboardingComplete,
      sidebarOpen: legacy.sidebarOpen,
      sidebarWidth: legacy.sidebarWidth,
      reopenRepositoriesOnLaunch: legacy.reopenRepositoriesOnLaunch,
      pullDivergedStrategy: legacy.pullDivergedStrategy,
      updateDownloadInBackground: legacy.updateDownloadInBackground,
      updateInstallOnQuit: legacy.updateInstallOnQuit,
      updateChannel: legacy.updateChannel
    },
    listPaneWidths: legacy.listPaneWidths,
    sidebarRefTreeToggles: legacy.sidebarRefTreeToggles
  }
}

function decodeScopedToggle(
  value: string
): { readonly path: string; readonly toggle: string } | null {
  if (!value.startsWith('repo:')) {
    return null
  }
  const separator = value.indexOf(':', 5)
  if (separator === -1) {
    return null
  }
  try {
    return {
      path: decodeURIComponent(value.slice(5, separator)),
      toggle: value.slice(separator + 1)
    }
  } catch {
    return null
  }
}

function migrateOneToTwo(value: unknown): ServerProfileState {
  const previous = Schema.decodeUnknownSync(DataSchemaOneStateSchema)(value) as DataSchemaOneState
  const localEnvironmentId = previous.environments[0]?.id
  if (!localEnvironmentId) {
    throw new Error('Schema 1 profile has no local Environment')
  }
  const preferences: Record<string, ServerProfileState['repositoryPreferences'][string]> = {}
  const getPreferences = (repository: RepoRef) => {
    const key = repositoryPreferenceKey(repository)
    const existing = preferences[key]
    if (existing) {
      return existing
    }
    const created = { repository, refTreeToggles: [] as string[] }
    preferences[key] = created
    return created
  }
  for (const [path, listPaneWidth] of Object.entries(previous.listPaneWidths)) {
    const repository = qualifyPath(localEnvironmentId, path)
    preferences[repositoryPreferenceKey(repository)] = {
      ...getPreferences(repository),
      listPaneWidth
    }
  }
  for (const value of previous.sidebarRefTreeToggles) {
    const scoped = decodeScopedToggle(value)
    if (!scoped) {
      continue
    }
    const repository = qualifyPath(localEnvironmentId, scoped.path)
    const current = getPreferences(repository)
    preferences[repositoryPreferenceKey(repository)] = {
      ...current,
      refTreeToggles: [...current.refTreeToggles, scoped.toggle]
    }
  }
  return {
    dataSchema: CURRENT_DATA_SCHEMA,
    environments: previous.environments,
    workspaces: previous.workspaces,
    activeWorkspace: previous.activeWorkspace,
    recents: previous.recents,
    tabs: previous.tabs,
    activeTabIndex: previous.activeTabIndex,
    settings: previous.settings,
    repositoryPreferences: preferences
  }
}

export function readDataSchema(value: unknown): number {
  if (typeof value !== 'object' || value === null || !('dataSchema' in value)) {
    return 0
  }
  const dataSchema = (value as { readonly dataSchema?: unknown }).dataSchema
  if (!Number.isSafeInteger(dataSchema) || (dataSchema as number) < 0) {
    throw new Error('Profile dataSchema must be a non-negative integer')
  }
  return dataSchema as number
}

export function migrateProfileState(
  value: unknown,
  localEnvironmentId: EnvironmentId
): ServerProfileState {
  const sourceDataSchema = readDataSchema(value)
  if (sourceDataSchema > CURRENT_DATA_SCHEMA) {
    throw new Error(`Profile data schema ${sourceDataSchema} is newer than ${CURRENT_DATA_SCHEMA}`)
  }
  let migrated: unknown = value
  for (let dataSchema = sourceDataSchema; dataSchema < CURRENT_DATA_SCHEMA; dataSchema += 1) {
    if (dataSchema === 0) {
      migrated = migrateLegacyToOne(migrated, localEnvironmentId)
    } else if (dataSchema === 1) {
      migrated = migrateOneToTwo(migrated)
    } else {
      throw new Error(`No migration from data schema ${dataSchema}`)
    }
  }
  return Schema.decodeUnknownSync(ServerProfileStateSchema)(migrated) as ServerProfileState
}
