import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { EnvironmentId } from '@common/features/repository-identity'
import { Data, Effect, type Scope } from 'effect4'
import { migrateProfileState, readDataSchema } from './profile-migrations'
import { CURRENT_DATA_SCHEMA, type ServerProfileState } from './profile-schema'
import {
  type ProfileIdentity,
  type SelectProfileOptions,
  selectIsolatedProfile,
  selectProfile
} from './profile-selection'

export type ProfileStateFailureReason =
  | 'InvalidState'
  | 'MigrationFailed'
  | 'NewerSchema'
  | 'ProfileLocked'
  | 'ReadFailed'
  | 'WriteFailed'

export class ProfileStateFailure extends Data.TaggedError('ProfileStateFailure')<{
  readonly reason: ProfileStateFailureReason
  readonly message: string
  readonly profileDirectory: string
  readonly cause?: unknown
}> {}

export interface OpenProfileStateOptions extends SelectProfileOptions {
  readonly localEnvironmentId: EnvironmentId
  readonly isolationId: string
  readonly legacyElectronConfigPath?: string
}

export interface ProfileStateStore {
  readonly profile: ProfileIdentity
  readonly state: ServerProfileState
  readonly save: (state: ServerProfileState) => Effect.Effect<void, ProfileStateFailure>
}

const stateFileName = 'state.json'
const lockFileName = 'writer.lock'
const maximumMigrationBackupsPerSchema = 100

function failure(
  reason: ProfileStateFailureReason,
  profileDirectory: string,
  message: string,
  cause?: unknown
): ProfileStateFailure {
  return new ProfileStateFailure({ reason, profileDirectory, message, cause })
}

function stringifyState(state: ServerProfileState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

async function writeAtomically(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    const temporaryHandle = await open(temporaryPath, 'wx')
    try {
      await temporaryHandle.writeFile(contents, 'utf8')
      await temporaryHandle.sync()
    } finally {
      await temporaryHandle.close()
    }
    await rename(temporaryPath, filePath)
    try {
      const directoryHandle = await open(path.dirname(filePath), 'r')
      try {
        await directoryHandle.sync()
      } finally {
        await directoryHandle.close()
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EACCES')) {
        throw error
      }
    }
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

async function writeMigrationBackup(
  profileDirectory: string,
  sourceDataSchema: number,
  raw: string
): Promise<string> {
  for (let attempt = 0; attempt < maximumMigrationBackupsPerSchema; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt}`
    const backupPath = path.join(
      profileDirectory,
      `state.backup-schema-${sourceDataSchema}${suffix}.json`
    )
    try {
      await writeFile(backupPath, raw, { encoding: 'utf8', flag: 'wx' })
      return backupPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }
  throw new Error(`Profile has ${maximumMigrationBackupsPerSchema} backups for this schema`)
}

async function readStateFile(
  profile: ProfileIdentity
): Promise<{ readonly raw: string; readonly value: unknown } | null> {
  const statePath = path.join(profile.directory, stateFileName)
  try {
    const raw = await readFile(statePath, 'utf8')
    return { raw, value: JSON.parse(raw) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw failure('ReadFailed', profile.directory, 'Could not read profile state', error)
  }
}

async function readLegacyElectronConfig(
  profile: ProfileIdentity,
  legacyElectronConfigPath: string | undefined
): Promise<{ readonly raw: string; readonly value: unknown } | null> {
  if (!legacyElectronConfigPath) {
    return null
  }
  try {
    const raw = await readFile(legacyElectronConfigPath, 'utf8')
    return { raw, value: JSON.parse(raw) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw failure('ReadFailed', profile.directory, 'Could not read legacy Electron state', error)
  }
}

async function rejectNewerStateBeforeLock(
  profile: ProfileIdentity,
  legacyElectronConfigPath: string | undefined
): Promise<void> {
  const source =
    (await readStateFile(profile)) ??
    (await readLegacyElectronConfig(profile, legacyElectronConfigPath))
  if (!source) {
    return
  }
  let dataSchema: number
  try {
    dataSchema = readDataSchema(source.value)
  } catch (error) {
    throw failure('InvalidState', profile.directory, 'Profile data schema is invalid', error)
  }
  if (dataSchema > CURRENT_DATA_SCHEMA) {
    throw failure(
      'NewerSchema',
      profile.directory,
      `Profile data schema ${dataSchema} is newer than ${CURRENT_DATA_SCHEMA}`
    )
  }
}

function acquireProfileLock(
  profile: ProfileIdentity
): Effect.Effect<string, ProfileStateFailure, Scope.Scope> {
  const lockPath = path.join(profile.directory, lockFileName)
  const writerToken = `${process.pid}:${randomUUID()}`
  const removeStaleLock = async (): Promise<boolean> => {
    let persistedToken: string
    try {
      persistedToken = (await readFile(lockPath, 'utf8')).trim()
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
    }
    const separator = persistedToken.indexOf(':')
    const writerProcessId = Number(persistedToken.slice(0, separator))
    if (separator <= 0 || !Number.isSafeInteger(writerProcessId) || writerProcessId <= 0) {
      return false
    }
    try {
      process.kill(writerProcessId, 0)
      return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        return false
      }
    }
    if ((await readFile(lockPath, 'utf8').catch(() => '')).trim() !== persistedToken) {
      return false
    }
    await rm(lockPath, { force: true })
    return true
  }
  const createLock = async () => {
    try {
      return await open(lockPath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await removeStaleLock())) {
        throw error
      }
      return open(lockPath, 'wx')
    }
  }
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        await mkdir(profile.directory, { recursive: true })
        const handle = await createLock()
        try {
          await handle.writeFile(`${writerToken}\n`, 'utf8')
          return handle
        } catch (error) {
          await handle.close().catch(() => undefined)
          await rm(lockPath, { force: true }).catch(() => undefined)
          throw error
        }
      },
      catch: (error) =>
        failure(
          (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'ProfileLocked' : 'WriteFailed',
          profile.directory,
          (error as NodeJS.ErrnoException).code === 'EEXIST'
            ? 'Profile already has a writer'
            : 'Could not acquire profile writer lock',
          error
        )
    }),
    (handle) =>
      Effect.promise(async () => {
        await handle.close().catch(() => undefined)
        const persistedToken = await readFile(lockPath, 'utf8').catch(() => '')
        if (persistedToken.trim() === writerToken) {
          await rm(lockPath, { force: true }).catch(() => undefined)
        }
      })
  ).pipe(Effect.as(writerToken))
}

function initialProfileState(localEnvironmentId: EnvironmentId): ServerProfileState {
  return {
    dataSchema: CURRENT_DATA_SCHEMA,
    environments: [{ id: localEnvironmentId, kind: 'local', name: 'Local' }],
    workspaces: [],
    activeWorkspace: null,
    recents: [],
    tabs: [null],
    activeTabIndex: 0,
    settings: {
      onboardingComplete: false,
      sidebarOpen: true,
      sidebarWidth: 244,
      reopenRepositoriesOnLaunch: true,
      pullDivergedStrategy: null,
      updateDownloadInBackground: true,
      updateInstallOnQuit: true,
      updateChannel: null
    },
    repositoryPreferences: {}
  }
}

async function verifyProfileWriter(profile: ProfileIdentity, writerToken: string): Promise<void> {
  const lockPath = path.join(profile.directory, lockFileName)
  let persistedToken: string
  try {
    persistedToken = (await readFile(lockPath, 'utf8')).trim()
  } catch (error) {
    throw failure(
      'ProfileLocked',
      profile.directory,
      'Profile writer scope has been released',
      error
    )
  }
  if (persistedToken !== writerToken) {
    throw failure('ProfileLocked', profile.directory, 'Profile writer authority has changed')
  }
}

function initializeLockedProfile(
  profile: ProfileIdentity,
  options: OpenProfileStateOptions,
  writerToken: string
): Effect.Effect<ProfileStateStore, ProfileStateFailure> {
  return Effect.tryPromise({
    try: async () => {
      const statePath = path.join(profile.directory, stateFileName)
      const existing = await readStateFile(profile)
      let state: ServerProfileState
      if (!existing) {
        const legacy = await readLegacyElectronConfig(profile, options.legacyElectronConfigPath)
        if (legacy) {
          try {
            await writeMigrationBackup(profile.directory, 0, legacy.raw)
            state = migrateProfileState(legacy.value, options.localEnvironmentId)
          } catch (error) {
            throw error instanceof ProfileStateFailure
              ? error
              : failure(
                  'MigrationFailed',
                  profile.directory,
                  'Could not migrate legacy Electron state',
                  error
                )
          }
          await writeAtomically(statePath, stringifyState(state))
        } else {
          state = initialProfileState(options.localEnvironmentId)
          await writeAtomically(statePath, stringifyState(state))
        }
      } else {
        let sourceDataSchema: number
        try {
          sourceDataSchema = readDataSchema(existing.value)
        } catch (error) {
          throw failure('InvalidState', profile.directory, 'Profile data schema is invalid', error)
        }
        if (sourceDataSchema > CURRENT_DATA_SCHEMA) {
          throw failure(
            'NewerSchema',
            profile.directory,
            `Profile data schema ${sourceDataSchema} is newer than ${CURRENT_DATA_SCHEMA}`
          )
        }
        if (sourceDataSchema < CURRENT_DATA_SCHEMA) {
          try {
            await writeMigrationBackup(profile.directory, sourceDataSchema, existing.raw)
          } catch (error) {
            throw failure(
              'WriteFailed',
              profile.directory,
              'Could not back up profile state',
              error
            )
          }
        }
        try {
          state = migrateProfileState(existing.value, options.localEnvironmentId)
        } catch (error) {
          throw failure(
            'MigrationFailed',
            profile.directory,
            'Could not migrate profile state',
            error
          )
        }
        if (sourceDataSchema < CURRENT_DATA_SCHEMA) {
          await writeAtomically(statePath, stringifyState(state))
        }
      }

      const save = (state: ServerProfileState): Effect.Effect<void, ProfileStateFailure> =>
        Effect.tryPromise({
          try: async () => {
            await verifyProfileWriter(profile, writerToken)
            await writeAtomically(statePath, stringifyState(state))
          },
          catch: (error) =>
            error instanceof ProfileStateFailure
              ? error
              : failure('WriteFailed', profile.directory, 'Could not save profile state', error)
        })

      return {
        profile,
        state,
        save
      }
    },
    catch: (error) =>
      error instanceof ProfileStateFailure
        ? error
        : failure('ReadFailed', profile.directory, 'Could not initialize profile state', error)
  })
}

function openSelectedProfile(
  profile: ProfileIdentity,
  options: OpenProfileStateOptions
): Effect.Effect<ProfileStateStore, ProfileStateFailure, Scope.Scope> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => rejectNewerStateBeforeLock(profile, options.legacyElectronConfigPath),
      catch: (error) =>
        error instanceof ProfileStateFailure
          ? error
          : failure('ReadFailed', profile.directory, 'Could not inspect profile state', error)
    })
    const writerToken = yield* acquireProfileLock(profile)
    return yield* initializeLockedProfile(profile, options, writerToken)
  })
}

export function openProfileState(
  options: OpenProfileStateOptions
): Effect.Effect<ProfileStateStore, ProfileStateFailure, Scope.Scope> {
  const selected = selectProfile(options)
  return openSelectedProfile(selected, options).pipe(
    Effect.catchTag('ProfileStateFailure', (error) => {
      if (error.reason !== 'ProfileLocked') {
        return Effect.fail(error)
      }
      return openSelectedProfile(selectIsolatedProfile(selected, options.isolationId), options)
    })
  )
}
