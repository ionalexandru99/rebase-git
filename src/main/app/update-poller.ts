export interface UpdatePollerOptions {
  startupDelayMs: number
  intervalMs: number
  runCheck: () => void
}

export interface UpdatePoller {
  start: () => void
  stop: () => void
}

export function createUpdatePoller(options: UpdatePollerOptions): UpdatePoller {
  let startupTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null

  const start = (): void => {
    if (startupTimer !== null || intervalTimer !== null) {
      return
    }
    startupTimer = setTimeout(() => {
      startupTimer = null
      options.runCheck()
    }, options.startupDelayMs)
    intervalTimer = setInterval(() => {
      options.runCheck()
    }, options.intervalMs)
  }

  const stop = (): void => {
    if (startupTimer !== null) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    if (intervalTimer !== null) {
      clearInterval(intervalTimer)
      intervalTimer = null
    }
  }

  return { start, stop }
}
