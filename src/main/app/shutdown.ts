export interface BeforeQuitEvent {
  preventDefault: () => void
}

export function createBeforeQuitHandler(
  shutdown: () => Promise<void>,
  quit: () => void
): (event: BeforeQuitEvent) => void {
  let shutdownStarted = false
  let shutdownFinished = false

  return (event) => {
    if (shutdownFinished) {
      return
    }
    event.preventDefault()
    if (shutdownStarted) {
      return
    }
    shutdownStarted = true
    void shutdown().then(
      () => {
        shutdownFinished = true
        quit()
      },
      () => {
        shutdownFinished = true
        quit()
      }
    )
  }
}
