import type { UpdaterState } from '@shared/schemas/ipc'
import { describe, expect, it } from 'vitest'
import {
  createInitialUpdaterState,
  describeRejectedUpdaterAction,
  reduceUpdaterState,
  type UpdaterEvent
} from '../update-state'

const CHECKED_AT = '2026-08-08T10:00:00.000Z'
const LATER = '2026-08-08T11:00:00.000Z'

const supportedState = (overrides: Partial<UpdaterState> = {}): UpdaterState => ({
  ...createInitialUpdaterState('1.2.3', { supported: true }),
  ...overrides
})

const apply = (state: UpdaterState, ...events: UpdaterEvent[]): UpdaterState =>
  events.reduce(reduceUpdaterState, state)

describe('createInitialUpdaterState', () => {
  it('starts idle with the running version', () => {
    expect(createInitialUpdaterState('1.2.3', { supported: true })).toEqual({
      status: 'idle',
      supported: true,
      unsupportedReason: null,
      currentVersion: '1.2.3',
      availableVersion: null,
      downloadPercent: null,
      lastCheckedAt: null,
      errorMessage: null
    })
  })

  it('carries the reason a build cannot update itself', () => {
    const state = createInitialUpdaterState('1.2.3', {
      supported: false,
      reason: 'This build runs straight from source.'
    })

    expect(state.supported).toBe(false)
    expect(state.unsupportedReason).toBe('This build runs straight from source.')
  })
})

describe('reduceUpdaterState', () => {
  it('moves to checking and clears a previous failure', () => {
    const state = supportedState({ status: 'error', errorMessage: 'network down' })

    const next = reduceUpdaterState(state, { type: 'checking' })

    expect(next.status).toBe('checking')
    expect(next.errorMessage).toBeNull()
    expect(next.downloadPercent).toBeNull()
  })

  it('records an available update with the time of the check', () => {
    const next = apply(
      supportedState(),
      { type: 'checking' },
      { type: 'update-available', version: '1.3.0', at: CHECKED_AT }
    )

    expect(next.status).toBe('available')
    expect(next.availableVersion).toBe('1.3.0')
    expect(next.lastCheckedAt).toBe(CHECKED_AT)
  })

  it('records being up to date and forgets a stale available version', () => {
    const next = apply(
      supportedState({ status: 'available', availableVersion: '1.3.0' }),
      { type: 'checking' },
      { type: 'update-not-available', at: LATER }
    )

    expect(next.status).toBe('up-to-date')
    expect(next.availableVersion).toBeNull()
    expect(next.lastCheckedAt).toBe(LATER)
  })

  it('tracks a download from start through progress to completion', () => {
    const started = apply(supportedState({ status: 'available', availableVersion: '1.3.0' }), {
      type: 'download-started'
    })
    expect(started.status).toBe('downloading')
    expect(started.downloadPercent).toBe(0)

    const progressed = reduceUpdaterState(started, { type: 'download-progress', percent: 42.5 })
    expect(progressed.status).toBe('downloading')
    expect(progressed.downloadPercent).toBe(42.5)

    const downloaded = reduceUpdaterState(progressed, {
      type: 'update-downloaded',
      version: '1.3.0'
    })
    expect(downloaded.status).toBe('downloaded')
    expect(downloaded.downloadPercent).toBe(100)
    expect(downloaded.availableVersion).toBe('1.3.0')
  })

  it('accepts progress that arrives before any download-started event', () => {
    const next = reduceUpdaterState(
      supportedState({ status: 'available', availableVersion: '1.3.0' }),
      { type: 'download-progress', percent: 10 }
    )

    expect(next.status).toBe('downloading')
    expect(next.downloadPercent).toBe(10)
  })

  it('accepts a downloaded update without any progress events', () => {
    const next = reduceUpdaterState(supportedState({ status: 'checking' }), {
      type: 'update-downloaded',
      version: '1.4.0'
    })

    expect(next.status).toBe('downloaded')
    expect(next.availableVersion).toBe('1.4.0')
  })

  it('stamps the check time when a check itself fails', () => {
    const next = apply(
      supportedState(),
      { type: 'checking' },
      { type: 'update-error', message: 'cannot reach the update server', at: CHECKED_AT }
    )

    expect(next.status).toBe('error')
    expect(next.errorMessage).toBe('cannot reach the update server')
    expect(next.lastCheckedAt).toBe(CHECKED_AT)
  })

  it('returns to available when a download of a known update fails', () => {
    const next = apply(
      supportedState({
        status: 'available',
        availableVersion: '1.3.0',
        lastCheckedAt: CHECKED_AT
      }),
      { type: 'download-started' },
      { type: 'update-error', message: 'disk full', at: LATER }
    )

    expect(next.status).toBe('available')
    expect(next.availableVersion).toBe('1.3.0')
    expect(next.errorMessage).toBe('disk full')
    expect(next.lastCheckedAt).toBe(CHECKED_AT)
    expect(next.downloadPercent).toBeNull()
  })

  it('lands on error when a failure hits with no known update', () => {
    const next = reduceUpdaterState(supportedState(), {
      type: 'update-error',
      message: 'unexpected failure',
      at: LATER
    })

    expect(next.status).toBe('error')
    expect(next.errorMessage).toBe('unexpected failure')
  })

  it('clears the failure once the next check finds an update', () => {
    const next = apply(
      supportedState({ status: 'error', errorMessage: 'network down' }),
      { type: 'checking' },
      { type: 'update-available', version: '1.3.0', at: LATER }
    )

    expect(next.errorMessage).toBeNull()
    expect(next.status).toBe('available')
  })
})

describe('describeRejectedUpdaterAction', () => {
  it('rejects every action on a build that cannot update itself', () => {
    const state = supportedState({
      supported: false,
      unsupportedReason: 'Updates are switched off in this build.'
    })

    expect(describeRejectedUpdaterAction(state, 'check')).toBe(
      'Updates are switched off in this build.'
    )
    expect(describeRejectedUpdaterAction(state, 'download')).toBe(
      'Updates are switched off in this build.'
    )
    expect(describeRejectedUpdaterAction(state, 'install')).toBe(
      'Updates are switched off in this build.'
    )
  })

  it('allows a check whenever nothing is checking or downloading', () => {
    for (const status of ['idle', 'up-to-date', 'available', 'downloaded', 'error'] as const) {
      expect(describeRejectedUpdaterAction(supportedState({ status }), 'check')).toBeNull()
    }
  })

  it('rejects a second check while one is running', () => {
    expect(describeRejectedUpdaterAction(supportedState({ status: 'checking' }), 'check')).toBe(
      'A check for updates is already running.'
    )
  })

  it('rejects a check while a download is in progress', () => {
    expect(describeRejectedUpdaterAction(supportedState({ status: 'downloading' }), 'check')).toBe(
      'An update is downloading right now.'
    )
  })

  it('allows a download only when an update is available', () => {
    expect(
      describeRejectedUpdaterAction(
        supportedState({ status: 'available', availableVersion: '1.3.0' }),
        'download'
      )
    ).toBeNull()
    expect(describeRejectedUpdaterAction(supportedState({ status: 'idle' }), 'download')).toBe(
      'There is no update to download yet.'
    )
    expect(
      describeRejectedUpdaterAction(supportedState({ status: 'downloading' }), 'download')
    ).toBe('That update is already downloading.')
    expect(describeRejectedUpdaterAction(supportedState({ status: 'checking' }), 'download')).toBe(
      'A check for updates is still running.'
    )
    expect(
      describeRejectedUpdaterAction(supportedState({ status: 'downloaded' }), 'download')
    ).toBe('That update is already downloaded.')
  })

  it('allows an install only once the download has finished', () => {
    expect(
      describeRejectedUpdaterAction(supportedState({ status: 'downloaded' }), 'install')
    ).toBeNull()
    expect(
      describeRejectedUpdaterAction(supportedState({ status: 'downloading' }), 'install')
    ).toBe('The update is still downloading.')
    expect(describeRejectedUpdaterAction(supportedState({ status: 'available' }), 'install')).toBe(
      'No update has finished downloading yet.'
    )
  })
})
