import { Context, Effect, ManagedRuntime } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  createSidecarLifecycle,
  createSidecarLifecycleLayer,
  type SidecarLifecycle,
  type SidecarResource
} from '../lifecycle'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fakeResource(value: string, initiallyReady = false) {
  const ready = deferred<void>()
  const exited = deferred<void>()
  const stop = vi.fn(async () => {
    ready.resolve()
    exited.resolve()
  })
  if (initiallyReady) {
    ready.resolve()
  }
  const resource: SidecarResource<string> = {
    value,
    ready: ready.promise,
    exited: exited.promise,
    stop
  }
  return { resource, ready, exited, stop }
}

describe('sidecar lifecycle ownership', () => {
  it('stops the running child when its managed runtime is disposed', async () => {
    const child = fakeResource('child', true)
    const Lifecycle = Context.GenericTag<SidecarLifecycle<string>>('test/SidecarLifecycle')
    const runtime = ManagedRuntime.make(
      createSidecarLifecycleLayer(Lifecycle, { launch: async () => child.resource })
    )

    await runtime.runPromise(
      Lifecycle.pipe(Effect.flatMap((lifecycle) => Effect.promise(() => lifecycle.start())))
    )
    await runtime.dispose()

    expect(child.stop).toHaveBeenCalledOnce()
  })

  it('stops a child owned by an in-progress start when its managed runtime is disposed', async () => {
    const child = fakeResource('child')
    const Lifecycle = Context.GenericTag<SidecarLifecycle<string>>('test/StartingSidecarLifecycle')
    const runtime = ManagedRuntime.make(
      createSidecarLifecycleLayer(Lifecycle, { launch: async () => child.resource })
    )

    const starting = runtime.runPromise(
      Lifecycle.pipe(Effect.flatMap((lifecycle) => Effect.promise(() => lifecycle.start())))
    )
    await Promise.resolve()
    await runtime.dispose()
    await starting.catch(() => {})

    expect(child.stop).toHaveBeenCalledOnce()
  })

  it('deduplicates startup and stops a child owned by an in-progress startup on shutdown', async () => {
    const child = fakeResource('child')
    const launch = vi.fn(async () => child.resource)
    const lifecycle = createSidecarLifecycle({ launch })

    const first = lifecycle.start()
    const second = lifecycle.start()
    expect(first).toBe(second)
    expect(launch).toHaveBeenCalledTimes(1)

    await lifecycle.shutdown()

    await expect(first).rejects.toThrow('sidecar is shutting down')
    expect(child.stop).toHaveBeenCalledTimes(1)
  })

  it('makes immediate starts join one backed-off restart after a crash', async () => {
    const firstChild = fakeResource('first', true)
    const secondChild = fakeResource('second', true)
    const resources = [firstChild.resource, secondChild.resource]
    const launch = vi.fn(async () => {
      const resource = resources.shift()
      if (!resource) {
        throw new Error('unexpected launch')
      }
      return resource
    })
    const resumeDelay = deferred<void>()
    const sleep = vi.fn(() => resumeDelay.promise)
    const lifecycle = createSidecarLifecycle({ launch, restartDelayMs: 250, sleep })

    await expect(lifecycle.start()).resolves.toBe('first')
    firstChild.exited.resolve()
    await Promise.resolve()

    const restart = lifecycle.restart()
    const concurrentRestart = lifecycle.restart()
    const immediateStart = lifecycle.start()
    expect(restart).toBe(concurrentRestart)
    expect(immediateStart).toBe(restart)
    await Promise.resolve()
    await Promise.resolve()
    expect(sleep).toHaveBeenCalledWith(250)
    expect(launch).toHaveBeenCalledTimes(1)

    resumeDelay.resolve()
    await expect(restart).resolves.toBe('second')
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('does not resolve shutdown until the running child exits', async () => {
    const child = fakeResource('child', true)
    const stopStarted = deferred<void>()
    const allowExit = deferred<void>()
    child.resource.stop = vi.fn(async () => {
      stopStarted.resolve()
      await allowExit.promise
      child.exited.resolve()
    })
    const lifecycle = createSidecarLifecycle({ launch: async () => child.resource })
    await lifecycle.start()

    let shutdownFinished = false
    const shutdown = lifecycle.shutdown().then(() => {
      shutdownFinished = true
    })
    await stopStarted.promise
    expect(shutdownFinished).toBe(false)

    allowExit.resolve()
    await shutdown
    expect(shutdownFinished).toBe(true)
  })
})
