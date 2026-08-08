import type { UpdaterState } from '@shared/schemas/ipc'

export type UpdaterSupport = { supported: true } | { supported: false; reason: string }

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'update-available'; version: string; at: string }
  | { type: 'update-not-available'; at: string }
  | { type: 'download-started' }
  | { type: 'download-progress'; percent: number }
  | { type: 'update-downloaded'; version: string }
  | { type: 'update-error'; message: string; at: string }

export type UpdaterAction = 'check' | 'download' | 'install'

export function createInitialUpdaterState(
  currentVersion: string,
  support: UpdaterSupport
): UpdaterState {
  return {
    status: 'idle',
    supported: support.supported,
    unsupportedReason: support.supported ? null : support.reason,
    currentVersion,
    availableVersion: null,
    downloadPercent: null,
    lastCheckedAt: null,
    errorMessage: null
  }
}

export function reduceUpdaterState(state: UpdaterState, event: UpdaterEvent): UpdaterState {
  switch (event.type) {
    case 'checking': {
      return { ...state, status: 'checking', downloadPercent: null, errorMessage: null }
    }
    case 'update-available': {
      return {
        ...state,
        status: 'available',
        availableVersion: event.version,
        downloadPercent: null,
        lastCheckedAt: event.at,
        errorMessage: null
      }
    }
    case 'update-not-available': {
      return {
        ...state,
        status: 'up-to-date',
        availableVersion: null,
        downloadPercent: null,
        lastCheckedAt: event.at,
        errorMessage: null
      }
    }
    case 'download-started': {
      return { ...state, status: 'downloading', downloadPercent: 0, errorMessage: null }
    }
    case 'download-progress': {
      return { ...state, status: 'downloading', downloadPercent: event.percent, errorMessage: null }
    }
    case 'update-downloaded': {
      return {
        ...state,
        status: 'downloaded',
        availableVersion: event.version,
        downloadPercent: 100,
        errorMessage: null
      }
    }
    case 'update-error': {
      const downloadFailedWithKnownUpdate =
        state.status === 'downloading' && state.availableVersion !== null
      return {
        ...state,
        status: downloadFailedWithKnownUpdate ? 'available' : 'error',
        downloadPercent: null,
        lastCheckedAt: state.status === 'checking' ? event.at : state.lastCheckedAt,
        errorMessage: event.message
      }
    }
  }
}

export function describeRejectedUpdaterAction(
  state: UpdaterState,
  action: UpdaterAction
): string | null {
  if (!state.supported) {
    return state.unsupportedReason ?? 'This build cannot update itself.'
  }
  if (action === 'check') {
    if (state.status === 'checking') {
      return 'A check for updates is already running.'
    }
    if (state.status === 'downloading') {
      return 'An update is downloading right now.'
    }
    return null
  }
  if (action === 'download') {
    if (state.status === 'downloading') {
      return 'That update is already downloading.'
    }
    if (state.status === 'checking') {
      return 'A check for updates is still running.'
    }
    if (state.status === 'downloaded') {
      return 'That update is already downloaded.'
    }
    if (state.status !== 'available') {
      return 'There is no update to download yet.'
    }
    return null
  }
  if (state.status === 'downloading') {
    return 'The update is still downloading.'
  }
  if (state.status !== 'downloaded') {
    return 'No update has finished downloading yet.'
  }
  return null
}
