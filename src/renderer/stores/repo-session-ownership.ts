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
  const canonicalOpenKeys = new Map<RepositoryIdentityKey, RepositoryIdentityKey>()
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
    const requestedKey = repositoryIdentityKey(requestedRepoRef)
    const canonicalKey = repositoryIdentityKey(canonicalRepoRef)
    canonicalPaths.set(requestedKey, canonicalRepoRef)
    canonicalPaths.set(canonicalKey, canonicalRepoRef)
    if (requestedKey === canonicalKey) {
      return
    }
    canonicalOpenKeys.set(requestedKey, canonicalKey)
    const requestedOpenCount = activeOpenRequests.get(requestedKey)
    if (requestedOpenCount !== undefined) {
      activeOpenRequests.delete(requestedKey)
      activeOpenRequests.set(
        canonicalKey,
        requestedOpenCount + (activeOpenRequests.get(canonicalKey) ?? 0)
      )
    }
    const requestedPendingClose = pendingCloses.get(requestedKey)
    if (requestedPendingClose !== undefined) {
      pendingCloses.delete(requestedKey)
      const canonicalPendingClose = pendingCloses.get(canonicalKey)
      if (canonicalPendingClose === undefined) {
        pendingCloses.set(canonicalKey, requestedPendingClose)
      } else if (canonicalPendingClose !== requestedPendingClose) {
        cancelTimer(requestedPendingClose)
      }
    }
  }

  const beginOpen = (requestedPath: RepositoryIdentity): RepositoryIdentityKey => {
    const identity = repositoryIdentityKey(resolveRepository(requestedPath))
    activeOpenRequests.set(identity, (activeOpenRequests.get(identity) ?? 0) + 1)
    return identity
  }

  const endOpen = (identity: RepositoryIdentityKey): void => {
    const activeIdentity = canonicalOpenKeys.get(identity) ?? identity
    const remaining = (activeOpenRequests.get(activeIdentity) ?? 0) - 1
    if (remaining > 0) {
      activeOpenRequests.set(activeIdentity, remaining)
    } else {
      activeOpenRequests.delete(activeIdentity)
      for (const [requestedKey, canonicalKey] of canonicalOpenKeys) {
        if (canonicalKey === activeIdentity) {
          canonicalOpenKeys.delete(requestedKey)
        }
      }
    }
  }

  const trackPendingClose = (repository: RepositoryIdentity, pendingClose: PendingClose): void => {
    pendingCloses.set(repositoryIdentityKey(resolveRepository(repository)), pendingClose)
  }

  const releasePendingClose = (repository: RepositoryIdentity): void => {
    pendingCloses.delete(repositoryIdentityKey(resolveRepository(repository)))
  }

  const cancelPendingClose = (repository: RepositoryIdentity): void => {
    const key = repositoryIdentityKey(resolveRepository(repository))
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
      pendingCloses.get(repositoryIdentityKey(resolveRepository(repository))) === pendingClose,
    releasePendingClose,
    cancelPendingClose
  }
}
