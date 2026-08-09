import { Effect, type Scope } from 'effect4'
import {
  createEnvironmentRegistry,
  type EnvironmentRegistry,
  LOCAL_ENVIRONMENT_ID
} from '../environment-registry'
import {
  type OpenProfileStateOptions,
  openProfileState,
  type ProfileStateFailure,
  type ProfileStateStore
} from '../profile-state'

export type OpenEnvironmentStateOptions = Omit<OpenProfileStateOptions, 'localEnvironmentId'>

export interface EnvironmentState<Agent> {
  readonly environments: EnvironmentRegistry<Agent>
  readonly profile: ProfileStateStore
}

export function openEnvironmentState<Agent>(
  localAgent: Agent,
  options: OpenEnvironmentStateOptions
): Effect.Effect<EnvironmentState<Agent>, ProfileStateFailure, Scope.Scope> {
  return openProfileState({ ...options, localEnvironmentId: LOCAL_ENVIRONMENT_ID }).pipe(
    Effect.map((profile) => ({
      environments: createEnvironmentRegistry(localAgent),
      profile
    }))
  )
}
