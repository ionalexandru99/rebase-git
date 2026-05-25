import { Effect } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllSnapshots,
  evictSnapshot,
  readSnapshot,
  readSnapshotSync,
  writeSnapshot,
  writeSnapshotSync
} from '@/lib/git-cache'

const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromise(effect)

describe('git-cache', () => {
  beforeEach(() => {
    clearAllSnapshots()
  })
  it('returns undefined for a repo that was never cached', async () => {
    expect(await run(readSnapshot('/missing'))).toBeUndefined()
  })

  it('merges successive patches for the same repo', async () => {
    await run(writeSnapshot('/repo', { currentBranch: 'main' }))
    await run(writeSnapshot('/repo', { defaultBranch: 'main' }))

    expect(await run(readSnapshot('/repo'))).toEqual({
      currentBranch: 'main',
      defaultBranch: 'main'
    })
  })

  it('evicts a single repo', async () => {
    await run(writeSnapshot('/repo', { currentBranch: 'main' }))
    await run(evictSnapshot('/repo'))

    expect(await run(readSnapshot('/repo'))).toBeUndefined()
  })

  it('caps the cache with write-recency LRU eviction', () => {
    for (let i = 0; i < 10; i++) writeSnapshotSync(`/repo${i}`, { currentBranch: 'main' })

    expect(readSnapshotSync('/repo0')).toBeUndefined()
    expect(readSnapshotSync('/repo1')).toBeUndefined()
    expect(readSnapshotSync('/repo2')).toBeDefined()
    expect(readSnapshotSync('/repo9')).toBeDefined()
  })

  it('refreshes recency when a cached repo is written again', () => {
    for (let i = 0; i < 8; i++) writeSnapshotSync(`/repo${i}`, { currentBranch: 'main' })
    writeSnapshotSync('/repo0', { defaultBranch: 'main' })
    writeSnapshotSync('/repo8', { currentBranch: 'main' })

    expect(readSnapshotSync('/repo0')).toBeDefined()
    expect(readSnapshotSync('/repo1')).toBeUndefined()
  })
})
