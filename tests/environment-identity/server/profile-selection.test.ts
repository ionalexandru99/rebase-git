import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { EnvironmentId } from '@common/features/repository-identity'
import { Effect } from 'effect4'
import {
  openProfileState,
  type ProfileStateStore
} from '../../../src/server/features/profile-state'

const localEnvironmentId = 'local' as EnvironmentId

describe('profile selection', () => {
  let profilesRoot = ''

  beforeEach(async () => {
    profilesRoot = await mkdtemp(path.join(os.tmpdir(), 'rebase-profile-selection-'))
  })

  afterEach(async () => {
    await rm(profilesRoot, { recursive: true, force: true })
  })

  const open = (
    launcher: 'electron' | 'npx',
    channel: 'stable' | 'nightly',
    explicitProfile?: string
  ): Promise<ProfileStateStore> =>
    Effect.runPromise(
      Effect.scoped(
        openProfileState({
          profilesRoot,
          launcher,
          channel,
          explicitProfile,
          isolationId: 'first',
          localEnvironmentId
        })
      )
    )

  it('separates launcher and release channel namespaces deterministically', async () => {
    const profiles = []
    for (const launcher of ['electron', 'npx'] as const) {
      for (const channel of ['stable', 'nightly'] as const) {
        profiles.push(await open(launcher, channel))
      }
    }

    expect(new Set(profiles.map((profile) => profile.profile.directory)).size).toBe(4)
    expect(profiles.map((profile) => profile.profile.name)).toEqual([
      'electron-stable',
      'electron-nightly',
      'npx-stable',
      'npx-nightly'
    ])
  })

  it('keeps an explicit profile identity visible', async () => {
    const explicit = await open('npx', 'stable', 'customer-a')

    expect(explicit.profile).toMatchObject({
      name: 'customer-a',
      directory: path.join(profilesRoot, 'customer-a'),
      isolated: false,
      isolationId: null
    })
  })

  it('rejects profile names that could escape the profile root', () => {
    expect(() =>
      openProfileState({
        profilesRoot,
        launcher: 'npx',
        channel: 'stable',
        explicitProfile: '../escape',
        isolationId: 'first',
        localEnvironmentId
      })
    ).toThrow('Invalid profile name')
  })
})
