import { type Context, Effect, Layer } from 'effect'

export interface SidecarResource<T> {
  value: T
  ready: Promise<void>
  exited: Promise<void>
  stop: () => Promise<void>
}

export interface SidecarLifecycleOptions<T> {
  launch: () => Promise<SidecarResource<T>>
  restartDelayMs?: number
  sleep?: (delayMs: number) => Promise<void>
}

interface StartingState<T> {
  tag: 'starting'
  resourcePromise: Promise<SidecarResource<T>>
  resource: SidecarResource<T> | null
  promise: Promise<T> | null
}

interface RunningState<T> {
  tag: 'running'
  resource: SidecarResource<T>
}

type LifecycleState<T> = { tag: 'idle' } | StartingState<T> | RunningState<T>

export interface SidecarLifecycle<T> {
  start: () => Promise<T>
  restart: () => Promise<T>
  shutdown: () => Promise<void>
}

const defaultSleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs))

export function createSidecarLifecycle<T>(
  options: SidecarLifecycleOptions<T>
): SidecarLifecycle<T> {
  let state: LifecycleState<T> = { tag: 'idle' }
  let restartPromise: Promise<T> | null = null
  let shutdownPromise: Promise<void> | null = null
  let shuttingDown = false
  const stopPromises = new WeakMap<SidecarResource<T>, Promise<void>>()
  const sleep = options.sleep ?? defaultSleep
  const restartDelayMs = options.restartDelayMs ?? 250

  const stopResource = (resource: SidecarResource<T>): Promise<void> => {
    const existing = stopPromises.get(resource)
    if (existing) {
      return existing
    }
    const stopping = resource.stop()
    stopPromises.set(resource, stopping)
    return stopping
  }

  const startNow = (): Promise<T> => {
    if (shuttingDown) {
      return Promise.reject(new Error('sidecar is shutting down'))
    }
    if (state.tag === 'running') {
      return Promise.resolve(state.resource.value)
    }
    if (state.tag === 'starting') {
      return state.promise as Promise<T>
    }

    const starting: StartingState<T> = {
      tag: 'starting',
      resourcePromise: options.launch(),
      resource: null,
      promise: null
    }
    state = starting
    starting.promise = (async () => {
      let resource: SidecarResource<T> | null = null
      try {
        resource = await starting.resourcePromise
        starting.resource = resource
        if (shuttingDown || state !== starting) {
          await stopResource(resource)
          throw new Error('sidecar is shutting down')
        }
        void resource.exited.then(
          () => {
            if ((state.tag === 'running' && state.resource === resource) || state === starting) {
              state = { tag: 'idle' }
            }
          },
          () => {
            if ((state.tag === 'running' && state.resource === resource) || state === starting) {
              state = { tag: 'idle' }
            }
          }
        )
        await resource.ready
        if (shuttingDown || state !== starting) {
          await stopResource(resource)
          throw new Error('sidecar is shutting down')
        }
        state = { tag: 'running', resource }
        return resource.value
      } catch (error) {
        if (resource) {
          await stopResource(resource)
        }
        if (state === starting) {
          state = { tag: 'idle' }
        }
        throw error
      }
    })()
    return starting.promise
  }

  const stopCurrent = async (): Promise<void> => {
    const current = state
    state = { tag: 'idle' }
    if (current.tag === 'idle') {
      return
    }
    if (current.tag === 'running') {
      await stopResource(current.resource)
      return
    }
    try {
      const resource = await current.resourcePromise
      await stopResource(resource)
    } catch {}
    try {
      await current.promise
    } catch {}
  }

  const start = (): Promise<T> => restartPromise ?? startNow()

  const restart = (): Promise<T> => {
    if (shuttingDown) {
      return Promise.reject(new Error('sidecar is shutting down'))
    }
    if (restartPromise) {
      return restartPromise
    }
    const restarting = (async () => {
      await stopCurrent()
      await sleep(restartDelayMs)
      return startNow()
    })()
    restartPromise = restarting
    void restarting
      .finally(() => {
        if (restartPromise === restarting) {
          restartPromise = null
        }
      })
      .catch(() => {})
    return restarting
  }

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise
    }
    shuttingDown = true
    shutdownPromise = (async () => {
      if (restartPromise) {
        try {
          await restartPromise
        } catch {}
      }
      await stopCurrent()
    })()
    return shutdownPromise
  }

  return { start, restart, shutdown }
}

export function createSidecarLifecycleLayer<Identifier, T>(
  tag: Context.Tag<Identifier, SidecarLifecycle<T>>,
  options: SidecarLifecycleOptions<T>
): Layer.Layer<Identifier> {
  return Layer.scoped(
    tag,
    Effect.acquireRelease(
      Effect.sync(() => createSidecarLifecycle(options)),
      (lifecycle) => Effect.promise(() => lifecycle.shutdown())
    )
  )
}
