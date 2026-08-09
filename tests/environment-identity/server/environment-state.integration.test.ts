import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect4'
import {
  LOCAL_ENVIRONMENT_ID,
  openEnvironmentState
} from '../../../src/server'

describe('Server Environment state composition', () => {
  let profilesRoot = ''

  beforeEach(async () => {
    profilesRoot = await mkdtemp(path.join(os.tmpdir(), 'rebase-environment-state-'))
  })

  afterEach(async () => {
    await rm(profilesRoot, { recursive: true, force: true })
  })

  it('uses the same implicit local identity for durable state and Agent routing', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* openEnvironmentState(
            { name: 'local-agent' },
            {
              profilesRoot,
              launcher: 'npx',
              channel: 'stable',
              isolationId: 'first'
            }
          )
          const routed = yield* state.environments.routeRepository(
            { environmentId: LOCAL_ENVIRONMENT_ID, path: '/native/repository' },
            (agent, nativePath) => Effect.succeed({ agent, nativePath })
          )
          return { state, routed }
        })
      )
    )

    expect(result.state.profile.state.environments).toEqual([
      { id: LOCAL_ENVIRONMENT_ID, kind: 'local', name: 'Local' }
    ])
    expect(result.routed).toEqual({
      agent: { name: 'local-agent' },
      nativePath: '/native/repository'
    })
  })
})
