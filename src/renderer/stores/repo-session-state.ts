import type { RepoRef } from '@common/features/repository-identity'

export interface OpenedRepo {
  path: string
  remotes: Record<string, string>
  defaultBranch?: string
}

export type RepoSessionErrorSource = 'session' | 'status' | 'mutation' | 'refs' | 'history'

export interface RepoSessionError {
  message: string
  sequence: number
}

export type RepoSessionErrors = Partial<Record<RepoSessionErrorSource, RepoSessionError>>

export interface RepoSessionState {
  repoRef: RepoRef | null
  repoPath: string | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  opening: boolean
  errors: RepoSessionErrors
  openGeneration: number
  resetEpoch: number
}

const errorSourcesByPriority: readonly RepoSessionErrorSource[] = [
  'session',
  'mutation',
  'history',
  'status',
  'refs'
]

export function initialRepoSessionState(openGeneration = 0, resetEpoch = 0): RepoSessionState {
  return {
    repoRef: null,
    repoPath: null,
    remotes: {},
    defaultBranch: undefined,
    opening: false,
    errors: {},
    openGeneration,
    resetEpoch
  }
}

export function startRepoOpening(
  previous: RepoSessionState,
  openGeneration: number
): RepoSessionState {
  return { ...previous, opening: true, errors: {}, openGeneration }
}

export function failRepoOpening(
  previous: RepoSessionState,
  message: string,
  sequence: number
): RepoSessionState {
  return {
    ...previous,
    opening: false,
    errors: { session: { message, sequence } }
  }
}

export function completeRepoOpening(
  previous: RepoSessionState,
  opened: OpenedRepo,
  repoRef: RepoRef,
  openGeneration: number
): RepoSessionState {
  return {
    ...previous,
    repoRef,
    repoPath: opened.path,
    remotes: opened.remotes,
    defaultBranch: opened.defaultBranch,
    opening: false,
    errors: {},
    openGeneration
  }
}

export function resetRepoSession(
  previous: RepoSessionState,
  openGeneration: number,
  incrementResetEpoch = false
): RepoSessionState {
  return initialRepoSessionState(
    openGeneration,
    previous.resetEpoch + (incrementResetEpoch ? 1 : 0)
  )
}

export function setRepoSessionError(
  previous: RepoSessionState,
  source: RepoSessionErrorSource,
  message: string,
  sequence: number
): RepoSessionState {
  return {
    ...previous,
    errors: { ...previous.errors, [source]: { message, sequence } }
  }
}

export function clearRepoSessionError(
  previous: RepoSessionState,
  source: RepoSessionErrorSource
): RepoSessionState {
  if (!previous.errors[source]) {
    return previous
  }
  const errors = { ...previous.errors }
  delete errors[source]
  return { ...previous, errors }
}

export function displayedRepoSessionError(errors: RepoSessionErrors): RepoSessionError | null {
  let selected: RepoSessionError | undefined
  for (const source of errorSourcesByPriority) {
    const candidate = errors[source]
    if (candidate && (!selected || candidate.sequence > selected.sequence)) {
      selected = candidate
    }
  }
  return selected ?? null
}
