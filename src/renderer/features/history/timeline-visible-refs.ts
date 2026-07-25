import {
  parseFilterRefKey,
  refFilterKey,
  resolveTrackingRemoteBranches
} from '@/features/history/selectors'

export function resolveDefaultTimelineBranch(
  localBranches: readonly string[],
  defaultBranch?: string,
  currentBranch?: string
): string | null {
  const candidates = [defaultBranch, currentBranch, 'main', 'master', localBranches[0]]
  for (const candidate of candidates) {
    if (candidate && localBranches.includes(candidate)) {
      return candidate
    }
  }
  return null
}

export function defaultVisibleTimelineRefs(
  localBranches: readonly string[],
  remoteBranches: readonly string[],
  defaultBranch?: string,
  currentBranch?: string,
  remoteNames?: ReadonlySet<string>
): Set<string> {
  const branch = resolveDefaultTimelineBranch(localBranches, defaultBranch, currentBranch)
  if (!branch) {
    return new Set()
  }
  const refs = new Set([refFilterKey('local', branch)])
  for (const trackingPath of resolveTrackingRemoteBranches(branch, remoteBranches, remoteNames)) {
    refs.add(refFilterKey('remote', trackingPath))
  }
  return refs
}

export function effectiveVisibleTimelineRefs(
  selected: ReadonlySet<string>,
  localBranches: readonly string[],
  remoteBranches: readonly string[],
  defaultBranch?: string,
  currentBranch?: string,
  remoteNames?: ReadonlySet<string>
): ReadonlySet<string> {
  if (selected.size > 0) {
    const available = new Set<string>()
    for (const branch of localBranches) {
      available.add(refFilterKey('local', branch))
    }
    for (const branch of remoteBranches) {
      available.add(refFilterKey('remote', branch))
    }
    const existing = new Set([...selected].filter((key) => available.has(key)))
    if (existing.size === selected.size) {
      return selected
    }
    if (existing.size > 0) {
      return existing
    }
  }
  return defaultVisibleTimelineRefs(
    localBranches,
    remoteBranches,
    defaultBranch,
    currentBranch,
    remoteNames
  )
}

export function toggleVisibleTimelineRef(
  selected: ReadonlySet<string>,
  key: string,
  localBranches: readonly string[],
  remoteBranches: readonly string[],
  defaultBranch?: string,
  currentBranch?: string,
  remoteNames?: ReadonlySet<string>
): Set<string> {
  const next = new Set(selected)
  if (next.has(key)) {
    next.delete(key)
    const parsed = parseFilterRefKey(key)
    if (parsed?.kind === 'local') {
      for (const trackingPath of resolveTrackingRemoteBranches(
        parsed.fullPath,
        remoteBranches,
        remoteNames
      )) {
        next.delete(refFilterKey('remote', trackingPath))
      }
    }
  } else {
    next.add(key)
    const parsed = parseFilterRefKey(key)
    if (parsed?.kind === 'local') {
      for (const trackingPath of resolveTrackingRemoteBranches(
        parsed.fullPath,
        remoteBranches,
        remoteNames
      )) {
        next.add(refFilterKey('remote', trackingPath))
      }
    }
  }
  if (next.size > 0) {
    return next
  }
  return defaultVisibleTimelineRefs(
    localBranches,
    remoteBranches,
    defaultBranch,
    currentBranch,
    remoteNames
  )
}
