import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { EnvironmentId } from '@common/features/repository-identity'
import { Effect, Exit } from 'effect4'
import {
  CURRENT_DATA_SCHEMA,
  openProfileState,
  type ProfileStateStore,
  repositoryPreferenceKey,
  type ServerProfileState
} from '../../../src/server/features/profile-state'

const localEnvironmentId = 'environment-local' as EnvironmentId

interface OpenOptions {
  readonly profilesRoot: string
  readonly launcher?: 'electron' | 'npx'
  readonly channel?: 'stable' | 'nightly'
  readonly isolationId?: string
  readonly explicitProfile?: string
  readonly legacyElectronConfigPath?: string
}

function openOptions(options: OpenOptions) {
  return {
    profilesRoot: options.profilesRoot,
    launcher: options.launcher ?? ('npx' as const),
    channel: options.channel ?? ('stable' as const),
    isolationId: options.isolationId ?? 'test-instance',
    explicitProfile: options.explicitProfile,
    legacyElectronConfigPath: options.legacyElectronConfigPath,
    localEnvironmentId
  }
}

async function withOpenProfile<A>(
  options: OpenOptions,
  use: (store: ProfileStateStore) => Promise<A>
): Promise<A> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openProfileState(openOptions(options))
        return yield* Effect.promise(() => use(store))
      })
    )
  )
}

describe('profile store initialization', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'rebase-profile-state-'))
  })

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('migrates a real 0.0.1 configuration sequentially and backs it up byte-for-byte', async () => {
    const original = await readFile(
      path.join(
        process.cwd(),
        'tests/environment-identity/server/fixtures/profile-0.0.1/config.json'
      ),
      'utf8'
    )
    const legacyProfileDirectory = path.join(temporaryRoot, 'legacy-electron')
    const legacyElectronConfigPath = path.join(legacyProfileDirectory, 'config.json')
    await mkdir(legacyProfileDirectory, { recursive: true })
    await writeFile(legacyElectronConfigPath, original)

    await withOpenProfile(
      {
        profilesRoot: temporaryRoot,
        launcher: 'electron',
        legacyElectronConfigPath
      },
      async (store) => {
      expect(store.state.dataSchema).toBe(CURRENT_DATA_SCHEMA)
      expect(store.state.environments).toEqual([
        { id: localEnvironmentId, kind: 'local', name: 'Local' }
      ])
      expect(store.state.workspaces).toEqual([
        { environmentId: localEnvironmentId, path: '/workspaces/one' },
        { environmentId: localEnvironmentId, path: '/workspaces/two' }
      ])
      expect(store.state.activeWorkspace).toEqual({
        environmentId: localEnvironmentId,
        path: '/workspaces/two'
      })
      expect(store.state.recents).toEqual([
        { environmentId: localEnvironmentId, path: '/repos/alpha' },
        { environmentId: localEnvironmentId, path: '/repos/beta' }
      ])
      expect(store.state.tabs).toEqual([
        { environmentId: localEnvironmentId, path: '/repos/beta' },
        null,
        { environmentId: localEnvironmentId, path: '/repos/alpha' }
      ])
      expect(store.state.activeTabIndex).toBe(2)
      expect(store.state.settings).toEqual({
        onboardingComplete: true,
        sidebarOpen: false,
        sidebarWidth: 312,
        reopenRepositoriesOnLaunch: false,
        pullDivergedStrategy: 'rebase',
        updateDownloadInBackground: false,
        updateInstallOnQuit: false,
        updateChannel: 'nightly'
      })
      const alpha = { environmentId: localEnvironmentId, path: '/repos/alpha' }
      const beta = { environmentId: localEnvironmentId, path: '/repos/beta' }
      expect(store.state.repositoryPreferences[repositoryPreferenceKey(alpha)]).toEqual({
        repository: alpha,
        listPaneWidth: 521,
        refTreeToggles: ['branch:feature%2Fone']
      })
      expect(store.state.repositoryPreferences[repositoryPreferenceKey(beta)]).toEqual({
        repository: beta,
        listPaneWidth: 642,
        refTreeToggles: ['branch:feature%2Ftwo']
      })
      expect(
        await readFile(path.join(store.profile.directory, 'state.backup-schema-0.json'), 'utf8')
      ).toBe(original)
      }
    )
  })

  it('remaps schema 1 local references to the runtime local Environment ID', async () => {
    const profileDirectory = path.join(temporaryRoot, 'npx-stable')
    const storedLocalEnvironmentId = 'stored-local' as EnvironmentId
    const remoteEnvironmentId = 'remote' as EnvironmentId
    const schemaOne = {
      dataSchema: 1,
      environments: [
        { id: storedLocalEnvironmentId, kind: 'local', name: 'Stored local' },
        { id: remoteEnvironmentId, kind: 'local', name: 'Remote' }
      ],
      workspaces: [
        { environmentId: storedLocalEnvironmentId, path: '/workspace' },
        { environmentId: remoteEnvironmentId, path: '/remote-workspace' }
      ],
      activeWorkspace: { environmentId: storedLocalEnvironmentId, path: '/workspace' },
      recents: [
        { environmentId: storedLocalEnvironmentId, path: '/repository' },
        { environmentId: remoteEnvironmentId, path: '/remote-repository' }
      ],
      tabs: [{ environmentId: storedLocalEnvironmentId, path: '/repository' }],
      activeTabIndex: 0,
      settings: {
        onboardingComplete: true,
        sidebarOpen: true,
        sidebarWidth: 244,
        reopenRepositoriesOnLaunch: true,
        pullDivergedStrategy: null,
        updateDownloadInBackground: true,
        updateInstallOnQuit: true,
        updateChannel: null
      },
      listPaneWidths: { '/repository': 500 },
      sidebarRefTreeToggles: []
    }
    await mkdir(profileDirectory, { recursive: true })
    await writeFile(path.join(profileDirectory, 'state.json'), `${JSON.stringify(schemaOne)}\n`)

    await withOpenProfile({ profilesRoot: temporaryRoot }, async (store) => {
      expect(store.state.environments.map((environment) => environment.id)).toEqual([
        localEnvironmentId,
        remoteEnvironmentId
      ])
      expect(store.state.workspaces).toEqual([
        { environmentId: localEnvironmentId, path: '/workspace' },
        { environmentId: remoteEnvironmentId, path: '/remote-workspace' }
      ])
      expect(store.state.recents).toEqual([
        { environmentId: localEnvironmentId, path: '/repository' },
        { environmentId: remoteEnvironmentId, path: '/remote-repository' }
      ])
      expect(store.state.tabs).toEqual([
        { environmentId: localEnvironmentId, path: '/repository' }
      ])
    })
  })

  it('opens equal schema without rewriting or creating a backup', async () => {
    let statePath = ''
    let before = ''
    await withOpenProfile({ profilesRoot: temporaryRoot }, async (created) => {
      statePath = path.join(created.profile.directory, 'state.json')
      before = await readFile(statePath, 'utf8')
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await withOpenProfile({ profilesRoot: temporaryRoot }, async (reopened) => {
      expect(await readFile(statePath, 'utf8')).toBe(before)
      expect((await readdir(reopened.profile.directory)).filter((name) => name.includes('backup'))).toEqual([])
    })
  })

  it('leaves original bytes intact and releases the lock after a failed migration', async () => {
    const profileDirectory = path.join(temporaryRoot, 'npx-stable')
    const legacyProfileDirectory = path.join(temporaryRoot, 'legacy-electron')
    const legacyElectronConfigPath = path.join(legacyProfileDirectory, 'config.json')
    const original = '{"recentRepos":"not-an-array"}\n'
    await mkdir(legacyProfileDirectory, { recursive: true })
    await writeFile(legacyElectronConfigPath, original)

    const first = await Effect.runPromiseExit(
      Effect.scoped(
        openProfileState(openOptions({ profilesRoot: temporaryRoot, legacyElectronConfigPath }))
      )
    )
    const second = await Effect.runPromiseExit(
      Effect.scoped(
        openProfileState(openOptions({ profilesRoot: temporaryRoot, legacyElectronConfigPath }))
      )
    )

    expect(Exit.isFailure(first)).toBe(true)
    expect(Exit.isFailure(second)).toBe(true)
    expect(await readFile(legacyElectronConfigPath, 'utf8')).toBe(original)
    await expect(readFile(path.join(profileDirectory, 'state.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await readFile(path.join(profileDirectory, 'state.backup-schema-0.json'), 'utf8')).toBe(
      original
    )
  })

  it('refuses newer schema without modifying the profile', async () => {
    const profileDirectory = path.join(temporaryRoot, 'npx-stable')
    const statePath = path.join(profileDirectory, 'state.json')
    const original = '{"dataSchema":999,"future":true}\n'
    await mkdir(profileDirectory, { recursive: true })
    await writeFile(statePath, original)
    const before = await stat(statePath)

    const exit = await Effect.runPromiseExit(
      Effect.scoped(openProfileState(openOptions({ profilesRoot: temporaryRoot })))
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(await readFile(statePath, 'utf8')).toBe(original)
    expect((await stat(statePath)).mtimeMs).toBe(before.mtimeMs)
    await expect(stat(path.join(profileDirectory, 'writer.lock'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(
      stat(path.join(profileDirectory, 'state.backup-schema-999.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a newer legacy import before creating the selected profile', async () => {
    const profileDirectory = path.join(temporaryRoot, 'electron-stable')
    const legacyProfileDirectory = path.join(temporaryRoot, 'legacy-electron')
    const legacyElectronConfigPath = path.join(legacyProfileDirectory, 'config.json')
    const original = '{"dataSchema":999,"future":true}\n'
    await mkdir(legacyProfileDirectory, { recursive: true })
    await writeFile(legacyElectronConfigPath, original)

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        openProfileState(
          openOptions({
            profilesRoot: temporaryRoot,
            launcher: 'electron',
            legacyElectronConfigPath
          })
        )
      )
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(await readFile(legacyElectronConfigPath, 'utf8')).toBe(original)
    await expect(stat(profileDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('opens an identified isolated profile for a concurrent default launcher', async () => {
    await withOpenProfile({ profilesRoot: temporaryRoot }, async (first) => {
      const activeLockPath = path.join(first.profile.directory, 'writer.lock')
      const activeWriterToken = await readFile(activeLockPath, 'utf8')
      await withOpenProfile(
        { profilesRoot: temporaryRoot, isolationId: 'launcher-two' },
        async (second) => {
          expect(first.profile.name).toBe('npx-stable')
          expect(second.profile).toMatchObject({
            name: 'npx-stable.instance-launcher-two',
            isolated: true,
            isolationId: 'launcher-two'
          })
          expect(await readFile(activeLockPath, 'utf8')).toBe(activeWriterToken)
        }
      )
    })
  })

  it('recovers a stale writer lock and opens the existing profile state', async () => {
    let profileDirectory = ''
    await withOpenProfile({ profilesRoot: temporaryRoot }, async (store) => {
      profileDirectory = store.profile.directory
      await Effect.runPromise(
        store.save({
          ...store.state,
          recents: [{ environmentId: localEnvironmentId, path: '/preserved/repository' }],
          tabs: [{ environmentId: localEnvironmentId, path: '/preserved/repository' }],
          settings: { ...store.state.settings, sidebarWidth: 411 }
        })
      )
    })
    await writeFile(path.join(profileDirectory, 'writer.lock'), '2147483647:stale\n')

    await withOpenProfile(
      { profilesRoot: temporaryRoot, isolationId: 'after-crash' },
      async (store) => {
        expect(store.profile.isolated).toBe(false)
        expect(store.state.recents).toEqual([
          { environmentId: localEnvironmentId, path: '/preserved/repository' }
        ])
        expect(store.state.tabs).toEqual([
          { environmentId: localEnvironmentId, path: '/preserved/repository' }
        ])
        expect(store.state.settings.sidebarWidth).toBe(411)
      }
    )
  })

  it('isolates a concurrent launcher even when the selected profile is explicit', async () => {
    await withOpenProfile(
      { profilesRoot: temporaryRoot, explicitProfile: 'shared-profile' },
      async () => {
        await withOpenProfile(
          {
            profilesRoot: temporaryRoot,
            explicitProfile: 'shared-profile',
            isolationId: 'explicit-launcher-two'
          },
          async (second) => {
            expect(second.profile).toMatchObject({
              name: 'shared-profile.instance-explicit-launcher-two',
              isolated: true,
              isolationId: 'explicit-launcher-two'
            })
          }
        )
      }
    )
  })

  it('never synchronizes independent profile state', async () => {
    let changedState: ServerProfileState | undefined
    await withOpenProfile(
      { profilesRoot: temporaryRoot, explicitProfile: 'profile-a' },
      async (profileA) => {
        changedState = {
          ...profileA.state,
          settings: { ...profileA.state.settings, sidebarWidth: 777 }
        }
        await Effect.runPromise(profileA.save(changedState))
      }
    )

    await withOpenProfile(
      { profilesRoot: temporaryRoot, explicitProfile: 'profile-b' },
      async (profileB) => {
        expect(changedState?.settings.sidebarWidth).toBe(777)
        expect(profileB.state.settings.sidebarWidth).toBe(244)
      }
    )
  })

  it('refuses writes after the profile writer scope is released', async () => {
    let releasedStore: ProfileStateStore | undefined
    await withOpenProfile({ profilesRoot: temporaryRoot }, async (store) => {
      releasedStore = store
    })

    const exit = await Effect.runPromiseExit(releasedStore!.save(releasedStore!.state))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({
        _tag: 'ProfileStateFailure',
        reason: 'ProfileLocked'
      })
    }
  })
})
