type PendingClose = ReturnType<typeof setTimeout>

export interface RepoSessionOwnership {
  nextOwner: () => number
  resolvePath: (requestedPath: string) => string
  rememberCanonicalPath: (requestedPath: string, canonicalPath: string) => void
  beginOpen: (requestedPath: string) => string
  endOpen: (identity: string) => void
  hasActiveOpen: (identity: string) => boolean
  trackPendingClose: (repoPath: string, pendingClose: PendingClose) => void
  matchesPendingClose: (repoPath: string, pendingClose: PendingClose) => boolean
  releasePendingClose: (repoPath: string) => void
  cancelPendingClose: (repoPath: string) => void
}

export function createRepoSessionOwnership(
  cancelTimer: (pendingClose: PendingClose) => void = clearTimeout
): RepoSessionOwnership {
  const pendingCloses = new Map<string, PendingClose>()
  const canonicalPaths = new Map<string, string>()
  const activeOpenRequests = new Map<string, number>()
  let ownerSequence = 0

  const resolvePath = (requestedPath: string): string =>
    canonicalPaths.get(requestedPath) ?? requestedPath

  const rememberCanonicalPath = (requestedPath: string, canonicalPath: string): void => {
    canonicalPaths.set(requestedPath, canonicalPath)
    canonicalPaths.set(canonicalPath, canonicalPath)
  }

  const beginOpen = (requestedPath: string): string => {
    const identity = resolvePath(requestedPath)
    activeOpenRequests.set(identity, (activeOpenRequests.get(identity) ?? 0) + 1)
    return identity
  }

  const endOpen = (identity: string): void => {
    const remaining = (activeOpenRequests.get(identity) ?? 0) - 1
    if (remaining > 0) {
      activeOpenRequests.set(identity, remaining)
    } else {
      activeOpenRequests.delete(identity)
    }
  }

  const trackPendingClose = (repoPath: string, pendingClose: PendingClose): void => {
    pendingCloses.set(repoPath, pendingClose)
  }

  const releasePendingClose = (repoPath: string): void => {
    pendingCloses.delete(repoPath)
  }

  const cancelPendingClose = (repoPath: string): void => {
    const pendingClose = pendingCloses.get(repoPath)
    if (pendingClose !== undefined) {
      cancelTimer(pendingClose)
      pendingCloses.delete(repoPath)
    }
  }

  return {
    nextOwner: () => ++ownerSequence,
    resolvePath,
    rememberCanonicalPath,
    beginOpen,
    endOpen,
    hasActiveOpen: (identity) => (activeOpenRequests.get(identity) ?? 0) > 0,
    trackPendingClose,
    matchesPendingClose: (repoPath, pendingClose) => pendingCloses.get(repoPath) === pendingClose,
    releasePendingClose,
    cancelPendingClose
  }
}
