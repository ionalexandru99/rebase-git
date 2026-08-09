import type { RepoRef } from '@common/features/repository-identity'
import {
  type RepositoryIdentity,
  type RepositoryIdentityKey,
  repositoryIdentityKey,
  toRepoRef
} from '@/features/repository-identity'

type PendingClose = ReturnType<typeof setTimeout>

export interface RepoSessionOwnership {
  nextOwner: () => number
  resolvePath: (requestedPath: RepositoryIdentity) => string
  rememberCanonicalPath: (
    requestedPath: RepositoryIdentity,
    canonicalPath: RepositoryIdentity
  ) => void
  beginOpen: (requestedPath: RepositoryIdentity) => RepositoryIdentityKey
  endOpen: (identity: RepositoryIdentityKey) => void
  hasActiveOpen: (repository: RepositoryIdentity) => boolean
  trackPendingClose: (repository: RepositoryIdentity, pendingClose: PendingClose) => void
  matchesPendingClose: (repository: RepositoryIdentity, pendingClose: PendingClose) => boolean
  releasePendingClose: (repository: RepositoryIdentity) => void
  cancelPendingClose: (repository: RepositoryIdentity) => void
}

export function createRepoSessionOwnership(
  cancelTimer: (pendingClose: PendingClose) => void = clearTimeout
): RepoSessionOwnership {
  const pendingCloses = new Map<RepositoryIdentityKey, PendingClose>()
  const canonicalPaths = new Map<RepositoryIdentityKey, RepoRef>()
  const activeOpenRequests = new Map<RepositoryIdentityKey, number>()
  let ownerSequence = 0

  const resolveRepository = (requestedPath: RepositoryIdentity): RepoRef =>
    canonicalPaths.get(repositoryIdentityKey(requestedPath)) ?? toRepoRef(requestedPath)

  const resolvePath = (requestedPath: RepositoryIdentity): string =>
    resolveRepository(requestedPath).path

  const rememberCanonicalPath = (
    requestedPath: RepositoryIdentity,
    canonicalPath: RepositoryIdentity
  ): void => {
    const requestedRepoRef = toRepoRef(requestedPath)
    const canonicalRepoRef =
      typeof canonicalPath === 'string'
        ? { ...requestedRepoRef, path: canonicalPath }
        : canonicalPath
    canonicalPaths.set(repositoryIdentityKey(requestedRepoRef), canonicalRepoRef)
    canonicalPaths.set(repositoryIdentityKey(canonicalRepoRef), canonicalRepoRef)
  }

  const beginOpen = (requestedPath: RepositoryIdentity): RepositoryIdentityKey => {
    const identity = repositoryIdentityKey(resolveRepository(requestedPath))
    activeOpenRequests.set(identity, (activeOpenRequests.get(identity) ?? 0) + 1)
    return identity
  }

  const endOpen = (identity: RepositoryIdentityKey): void => {
    const remaining = (activeOpenRequests.get(identity) ?? 0) - 1
    if (remaining > 0) {
      activeOpenRequests.set(identity, remaining)
    } else {
      activeOpenRequests.delete(identity)
    }
  }

  const trackPendingClose = (repository: RepositoryIdentity, pendingClose: PendingClose): void => {
    pendingCloses.set(repositoryIdentityKey(repository), pendingClose)
  }

  const releasePendingClose = (repository: RepositoryIdentity): void => {
    pendingCloses.delete(repositoryIdentityKey(repository))
  }

  const cancelPendingClose = (repository: RepositoryIdentity): void => {
    const key = repositoryIdentityKey(repository)
    const pendingClose = pendingCloses.get(key)
    if (pendingClose !== undefined) {
      cancelTimer(pendingClose)
      pendingCloses.delete(key)
    }
  }

  return {
    nextOwner: () => ++ownerSequence,
    resolvePath,
    rememberCanonicalPath,
    beginOpen,
    endOpen,
    hasActiveOpen: (repository) =>
      (activeOpenRequests.get(repositoryIdentityKey(resolveRepository(repository))) ?? 0) > 0,
    trackPendingClose,
    matchesPendingClose: (repository, pendingClose) =>
      pendingCloses.get(repositoryIdentityKey(repository)) === pendingClose,
    releasePendingClose,
    cancelPendingClose
  }
}
