import { describe, expect, it } from 'vitest'
import {
  clearAllSnapshots,
  hasCachedData,
  readSnapshot,
  writeSnapshot
} from '@/lib/repo-snapshot-cache'

describe('repo-snapshot-cache', () => {
  it('stores and reads snapshots per repo path', () => {
    clearAllSnapshots()
    writeSnapshot('/repo/a', { currentBranch: 'main' })
    expect(readSnapshot('/repo/a')?.currentBranch).toBe('main')
  })

  it('merges patches into existing snapshots', () => {
    clearAllSnapshots()
    writeSnapshot('/repo/b', { currentBranch: 'dev' })
    writeSnapshot('/repo/b', { defaultBranch: 'main' })
    expect(readSnapshot('/repo/b')).toEqual({ currentBranch: 'dev', defaultBranch: 'main' })
  })

  it('detects cached git payloads', () => {
    expect(hasCachedData(undefined)).toBe(false)
    expect(hasCachedData({ remotes: { origin: 'x' } })).toBe(false)
    expect(hasCachedData({ status: { current: 'main' } as never })).toBe(true)
  })
})
