import {
  type EnvironmentId,
  type EnvironmentPathRef,
  IMPLICIT_LOCAL_ENVIRONMENT_ID,
  type RepoRef
} from '@common/features/repository-identity'
import { Data, Effect } from 'effect4'

export const LOCAL_ENVIRONMENT_ID = IMPLICIT_LOCAL_ENVIRONMENT_ID

export interface EnvironmentRegistration<Agent> {
  readonly environmentId: EnvironmentId
  readonly agent: Agent
}

export class EnvironmentNotRegistered extends Data.TaggedError('EnvironmentNotRegistered')<{
  readonly environmentId: EnvironmentId
}> {}

export interface EnvironmentRegistry<Agent> {
  readonly localEnvironmentId: EnvironmentId
  readonly environmentIds: ReadonlyArray<EnvironmentId>
  readonly routeRepository: <A, E, R>(
    repoRef: RepoRef,
    operation: (agent: Agent, canonicalPath: string) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | EnvironmentNotRegistered, R>
  readonly routeEnvironmentPath: <A, E, R>(
    pathRef: EnvironmentPathRef,
    operation: (agent: Agent, path: string) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | EnvironmentNotRegistered, R>
}

function duplicateEnvironmentId(environmentId: EnvironmentId): TypeError {
  return new TypeError(`Environment ${environmentId} is registered more than once`)
}

export function createEnvironmentRegistry<Agent>(
  localAgent: Agent,
  additionalEnvironments: ReadonlyArray<EnvironmentRegistration<Agent>> = []
): EnvironmentRegistry<Agent> {
  const agents = new Map<EnvironmentId, Agent>([[LOCAL_ENVIRONMENT_ID, localAgent]])

  for (const environment of additionalEnvironments) {
    if (agents.has(environment.environmentId)) {
      throw duplicateEnvironmentId(environment.environmentId)
    }
    agents.set(environment.environmentId, environment.agent)
  }

  const routeNativePath = <A, E, R>(
    environmentId: EnvironmentId,
    path: string,
    operation: (agent: Agent, path: string) => Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | EnvironmentNotRegistered, R> =>
    Effect.suspend((): Effect.Effect<A, E | EnvironmentNotRegistered, R> => {
      const agent = agents.get(environmentId)
      return agent === undefined && !agents.has(environmentId)
        ? Effect.fail(new EnvironmentNotRegistered({ environmentId }))
        : operation(agent as Agent, path)
    })

  return {
    localEnvironmentId: LOCAL_ENVIRONMENT_ID,
    environmentIds: [...agents.keys()],
    routeRepository: (repoRef, operation) =>
      routeNativePath(repoRef.environmentId, repoRef.path, operation),
    routeEnvironmentPath: (pathRef, operation) =>
      routeNativePath(pathRef.environmentId, pathRef.path, operation)
  }
}
