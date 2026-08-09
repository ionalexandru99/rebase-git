import {
  EnvironmentIdSchema,
  IMPLICIT_LOCAL_ENVIRONMENT_ID,
  type RepoRef
} from '@common/features/repository-identity'
import type { PersistedTabRepository } from '@shared/schemas/ipc'

export type RepositoryIdentity = RepoRef | string

declare const repositoryIdentityKeyBrand: unique symbol

export type RepositoryIdentityKey = string & {
  readonly [repositoryIdentityKeyBrand]: true
}

export function toRepoRef(repository: RepositoryIdentity): RepoRef {
  return typeof repository === 'string'
    ? { environmentId: IMPLICIT_LOCAL_ENVIRONMENT_ID, path: repository }
    : repository
}

export function repositoryIdentityKey(repository: RepositoryIdentity): RepositoryIdentityKey {
  const repoRef = toRepoRef(repository)
  return JSON.stringify([repoRef.environmentId, repoRef.path]) as RepositoryIdentityKey
}

export function restorePersistedRepository(
  repository: PersistedTabRepository
): RepositoryIdentity | null {
  return typeof repository === 'object' && repository !== null
    ? {
        environmentId: EnvironmentIdSchema.make(repository.environmentId),
        path: repository.path
      }
    : repository
}
