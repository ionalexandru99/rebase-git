import { Context, Effect, Layer, ManagedRuntime } from 'effect'

export class FetchSemaphore {
  private available = 1
  private waitQueue: Array<() => void> = []
  private idleWaiters: Array<() => void> = []

  constructor(private readonly onIdle?: () => void) {}

  private take(): Promise<void> {
    if (this.available > 0) {
      this.available--
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.waitQueue.push(resolve)
    })
  }

  private give(): void {
    const next = this.waitQueue.shift()
    if (next) {
      next()
    } else {
      this.available++
      this.onIdle?.()
      for (const resolve of this.idleWaiters.splice(0)) {
        resolve()
      }
    }
  }

  async withPermits<T>(work: () => Promise<T>): Promise<T> {
    await this.take()
    try {
      return await work()
    } finally {
      this.give()
    }
  }

  async withPermitsIfAvailable<T>(work: () => Promise<T>): Promise<T | null> {
    if (this.available <= 0) {
      return null
    }
    return this.withPermits(work)
  }

  isBusy(): boolean {
    return this.available === 0 || this.waitQueue.length > 0
  }

  awaitIdle(): Promise<void> {
    if (!this.isBusy()) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve)
    })
  }
}

export interface FetchSemaphoresService {
  forRepo(repoPath: string): FetchSemaphore
  release(repoPath: string): boolean
  retain(repoPath: string): void
  size(): number
}

interface ManagedFetchSemaphores extends FetchSemaphoresService {
  close(): Promise<void>
}

function makeFetchSemaphores(): ManagedFetchSemaphores {
  const semaphores = new Map<string, FetchSemaphore>()
  const pendingReclaim = new Set<string>()
  let closing = false

  return {
    forRepo: (repoPath) => {
      if (closing) {
        throw new Error('fetch semaphore registry is closing')
      }
      let semaphore = semaphores.get(repoPath)
      if (!semaphore) {
        semaphore = new FetchSemaphore(() => {
          if (pendingReclaim.delete(repoPath) && semaphores.get(repoPath) === semaphore) {
            semaphores.delete(repoPath)
          }
        })
        semaphores.set(repoPath, semaphore)
      }
      return semaphore
    },
    release: (repoPath) => {
      const semaphore = semaphores.get(repoPath)
      if (semaphore?.isBusy()) {
        pendingReclaim.add(repoPath)
        return false
      }
      pendingReclaim.delete(repoPath)
      return semaphores.delete(repoPath)
    },
    retain: (repoPath) => {
      pendingReclaim.delete(repoPath)
    },
    size: () => semaphores.size,
    close: async () => {
      closing = true
      await Promise.all([...semaphores.values()].map((semaphore) => semaphore.awaitIdle()))
      pendingReclaim.clear()
      semaphores.clear()
    }
  }
}

export class FetchSemaphores extends Context.Tag('sidecar/FetchSemaphores')<
  FetchSemaphores,
  FetchSemaphoresService
>() {}

export const FetchSemaphoresLive = Layer.scoped(
  FetchSemaphores,
  Effect.acquireRelease(Effect.sync(makeFetchSemaphores), (registry) =>
    Effect.promise(() => registry.close())
  )
)

const fetchSemaphoresRuntime = ManagedRuntime.make(FetchSemaphoresLive)

function withFetchSemaphores<T>(use: (registry: FetchSemaphoresService) => T): T {
  return fetchSemaphoresRuntime.runSync(FetchSemaphores.pipe(Effect.map(use)))
}

export function fetchSemaphoreFor(repoPath: string): FetchSemaphore {
  return withFetchSemaphores((registry) => registry.forRepo(repoPath))
}

export function releaseFetchSemaphore(repoPath: string): boolean {
  return withFetchSemaphores((registry) => registry.release(repoPath))
}

export function retainFetchSemaphore(repoPath: string): void {
  withFetchSemaphores((registry) => registry.retain(repoPath))
}

export function fetchSemaphoreSize(): number {
  return withFetchSemaphores((registry) => registry.size())
}

export function finalizeFetchSemaphores(): Promise<void> {
  return fetchSemaphoresRuntime.dispose()
}
