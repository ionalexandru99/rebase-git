import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { releaseRepoSemaphore } from '../../session/lock'
import { makeRepo, removeRepoDir } from '../../test-support/repo-fixtures'
import { type RawGit, runWithConflictDetection } from '../conflict'

describe('runWithConflictDetection', () => {
  it('retries the conflictable mutation after transient index.lock contention', async () => {
    const repoPath = makeRepo([])
    const mergeArgs = ['merge', '--no-edit', 'feature', '--']
    const conflictCheckArgs = ['diff', '--name-only', '--diff-filter=U']
    const raw = vi
      .fn<RawGit['raw']>()
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error("Unable to create '.git/index.lock': File exists."))
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')

    try {
      await Effect.runPromise(runWithConflictDetection(repoPath, { raw }, mergeArgs))

      expect(raw).toHaveBeenNthCalledWith(1, conflictCheckArgs)
      expect(raw).toHaveBeenNthCalledWith(2, mergeArgs)
      expect(raw).toHaveBeenNthCalledWith(3, mergeArgs)
      expect(raw).toHaveBeenNthCalledWith(4, conflictCheckArgs)
      expect(raw).toHaveBeenCalledTimes(4)
    } finally {
      releaseRepoSemaphore(repoPath)
      removeRepoDir(repoPath)
    }
  })
})
