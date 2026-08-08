import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUpdatePoller } from '../update-poller'

const STARTUP_DELAY_MS = 30_000
const INTERVAL_MS = 4 * 60 * 60 * 1000

function makePoller() {
  const runCheck = vi.fn()
  const poller = createUpdatePoller({
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: INTERVAL_MS,
    runCheck
  })
  return { poller, runCheck }
}

describe('createUpdatePoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the first check shortly after start', () => {
    const { poller, runCheck } = makePoller()

    poller.start()
    vi.advanceTimersByTime(STARTUP_DELAY_MS - 1)
    expect(runCheck).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(runCheck).toHaveBeenCalledTimes(1)
  })

  it('keeps checking on the interval', () => {
    const { poller, runCheck } = makePoller()

    poller.start()
    vi.advanceTimersByTime(STARTUP_DELAY_MS + INTERVAL_MS * 2)

    expect(runCheck).toHaveBeenCalledTimes(3)
  })

  it('stop before the first check cancels everything', () => {
    const { poller, runCheck } = makePoller()

    poller.start()
    poller.stop()
    vi.advanceTimersByTime(STARTUP_DELAY_MS + INTERVAL_MS * 3)

    expect(runCheck).not.toHaveBeenCalled()
  })

  it('stop after the first check cancels the interval', () => {
    const { poller, runCheck } = makePoller()

    poller.start()
    vi.advanceTimersByTime(STARTUP_DELAY_MS)
    poller.stop()
    vi.advanceTimersByTime(INTERVAL_MS * 3)

    expect(runCheck).toHaveBeenCalledTimes(1)
  })

  it('a second start does not double the schedule', () => {
    const { poller, runCheck } = makePoller()

    poller.start()
    poller.start()
    vi.advanceTimersByTime(STARTUP_DELAY_MS + INTERVAL_MS)

    expect(runCheck).toHaveBeenCalledTimes(2)
  })

  it('can start again after a stop', () => {
    const { poller, runCheck } = makePoller()

    poller.start()
    poller.stop()
    poller.start()
    vi.advanceTimersByTime(STARTUP_DELAY_MS)

    expect(runCheck).toHaveBeenCalledTimes(1)
  })
})
