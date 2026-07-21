import { Context, Effect, Layer } from 'effect'

export interface RepoLifecycleQueueService {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
  open<T>(
    key: string,
    owner: number,
    task: () => Promise<T>,
    retainsOwnership?: (result: T) => boolean
  ): Promise<T>
  release<T>(key: string, owner: number, task: () => Promise<T>): Promise<T | undefined>
  disown(key: string, owner: number): Promise<void>
}

interface ManagedRepoLifecycleQueue extends RepoLifecycleQueueService {
  dispose(): Promise<void>
}

interface RepoOwnerClaim {
  owner: number
  previous: RepoOwnerClaim | undefined
  state: 'pending' | 'active' | 'abandoned'
}

function makeRepoLifecycleQueue(): ManagedRepoLifecycleQueue {
  const tails = new Map<string, Promise<void>>()
  const owners = new Map<string, RepoOwnerClaim>()
  let closing = false

  const run = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    if (closing) {
      return Promise.reject(new Error('repo lifecycle queue is closing'))
    }
    const previous = tails.get(key) ?? Promise.resolve()
    const result = previous.then(task, task)
    const completion = result.then(
      () => {},
      () => {}
    )
    tails.set(key, completion)
    void completion.then(() => {
      if (tails.get(key) === completion) {
        tails.delete(key)
      }
    })
    return result
  }

  const abandon = (key: string, claim: RepoOwnerClaim) => {
    claim.state = 'abandoned'
    if (owners.get(key) !== claim) {
      return
    }
    let previous = claim.previous
    while (previous?.state === 'abandoned') {
      previous = previous.previous
    }
    if (previous) {
      owners.set(key, previous)
    } else {
      owners.delete(key)
    }
  }

  return {
    run,
    open: <T>(
      key: string,
      owner: number,
      task: () => Promise<T>,
      retainsOwnership: (result: T) => boolean = () => true
    ): Promise<T> => {
      if (closing) {
        return Promise.reject(new Error('repo lifecycle queue is closing'))
      }
      const claim: RepoOwnerClaim = {
        owner,
        previous: owners.get(key),
        state: 'pending'
      }
      owners.set(key, claim)
      return run(key, async () => {
        try {
          const result = await task()
          if (!retainsOwnership(result)) {
            abandon(key, claim)
            return result
          }
          claim.state = 'active'
          return result
        } catch (error) {
          abandon(key, claim)
          throw error
        }
      })
    },
    release: <T>(key: string, owner: number, task: () => Promise<T>): Promise<T | undefined> => {
      return run(key, async () => {
        if (owners.get(key)?.owner !== owner) {
          return undefined
        }
        try {
          return await task()
        } finally {
          if (owners.get(key)?.owner === owner) {
            owners.delete(key)
          }
        }
      })
    },
    disown: (key: string, owner: number): Promise<void> => {
      return run(key, async () => {
        const claim = owners.get(key)
        if (claim?.owner === owner) {
          abandon(key, claim)
        }
      })
    },
    dispose: async () => {
      closing = true
      await Promise.all(tails.values())
      owners.clear()
    }
  }
}

export class RepoLifecycleQueue extends Context.Tag('main/RepoLifecycleQueue')<
  RepoLifecycleQueue,
  RepoLifecycleQueueService
>() {}

export const RepoLifecycleQueueLive = Layer.scoped(
  RepoLifecycleQueue,
  Effect.acquireRelease(Effect.sync(makeRepoLifecycleQueue), (queue) =>
    Effect.promise(() => queue.dispose())
  )
)
