import { EnvironmentIdSchema } from '../../../src/common/features/repository-identity'
import {
  EnvironmentNotRegistered,
  LOCAL_ENVIRONMENT_ID,
  createEnvironmentRegistry
} from '../../../src/server/features/environment-registry'
import { Effect } from 'effect4'
import { describe, expect, it, vi } from 'vitest'

interface TestAgent {
  readonly name: string
}

describe('Environment registry', () => {
  it('always includes the implicit local Environment', () => {
    const registry = createEnvironmentRegistry<TestAgent>({ name: 'local-agent' })

    expect(registry.localEnvironmentId).toBe(LOCAL_ENVIRONMENT_ID)
    expect(registry.environmentIds).toEqual([LOCAL_ENVIRONMENT_ID])
  })

  it('routes equal native paths to the Agent selected by EnvironmentId', async () => {
    const remoteEnvironmentId = EnvironmentIdSchema.make('remote')
    const localAgent = { name: 'local-agent' }
    const remoteAgent = { name: 'remote-agent' }
    const operation = vi.fn((agent: TestAgent, path: string) =>
      Effect.succeed(`${agent.name}:${path}`)
    )
    const registry = createEnvironmentRegistry(localAgent, [
      { environmentId: remoteEnvironmentId, agent: remoteAgent }
    ])

    await expect(
      Effect.runPromise(
        registry.routeRepository(
          { environmentId: LOCAL_ENVIRONMENT_ID, path: '/same/path' },
          operation
        )
      )
    ).resolves.toBe('local-agent:/same/path')
    await expect(
      Effect.runPromise(
        registry.routeRepository(
          { environmentId: remoteEnvironmentId, path: '/same/path' },
          operation
        )
      )
    ).resolves.toBe('remote-agent:/same/path')
    expect(operation).toHaveBeenNthCalledWith(1, localAgent, '/same/path')
    expect(operation).toHaveBeenNthCalledWith(2, remoteAgent, '/same/path')
  })

  it('strips EnvironmentId from non-repository path calls', async () => {
    const operation = vi.fn((_agent: TestAgent, path: string) => Effect.succeed(path))
    const registry = createEnvironmentRegistry<TestAgent>({ name: 'local-agent' })

    await Effect.runPromise(
      registry.routeEnvironmentPath(
        { environmentId: LOCAL_ENVIRONMENT_ID, path: '/clone/destination' },
        operation
      )
    )

    expect(operation).toHaveBeenCalledWith({ name: 'local-agent' }, '/clone/destination')
  })

  it('does not invoke an Agent for an unknown Environment', async () => {
    const missingEnvironmentId = EnvironmentIdSchema.make('missing')
    const operation = vi.fn(() => Effect.void)
    const registry = createEnvironmentRegistry<TestAgent>({ name: 'local-agent' })
    const failure = await Effect.runPromise(
      registry
        .routeRepository(
          { environmentId: missingEnvironmentId, path: '/workspace/rebase' },
          operation
        )
        .pipe(Effect.flip)
    )

    expect(operation).not.toHaveBeenCalled()
    expect(failure).toEqual(
      new EnvironmentNotRegistered({ environmentId: missingEnvironmentId })
    )
  })

  it('refuses duplicate and replacement local registrations', () => {
    const remoteEnvironmentId = EnvironmentIdSchema.make('remote')

    expect(() =>
      createEnvironmentRegistry<TestAgent>({ name: 'local-agent' }, [
        { environmentId: remoteEnvironmentId, agent: { name: 'first' } },
        { environmentId: remoteEnvironmentId, agent: { name: 'second' } }
      ])
    ).toThrow('Environment remote is registered more than once')
    expect(() =>
      createEnvironmentRegistry<TestAgent>({ name: 'local-agent' }, [
        { environmentId: LOCAL_ENVIRONMENT_ID, agent: { name: 'replacement' } }
      ])
    ).toThrow('Environment local is registered more than once')
  })
})
