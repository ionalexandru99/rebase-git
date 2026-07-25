export interface DebouncedDrain {
  push: () => void
  stop: () => void
}

export function startDebouncedDrain(delayMs: number, onFire: () => void): DebouncedDrain {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const push = () => {
    if (stopped) {
      return
    }
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      onFire()
    }, delayMs)
  }

  const stop = () => {
    stopped = true
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    timer = undefined
  }

  return { push, stop }
}
