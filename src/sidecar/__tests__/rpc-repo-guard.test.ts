import { RpcTest } from '@effect/rpc'
import { GitError } from '@shared/git-rpc-errors'
import { SidecarRpcs } from '@shared/rpc'
import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { handlersLayer } from '../rpc-handlers'

const invalidRepo = '/no/such/rebase/path/here'

describe('repo path guard across the RPC group', () => {
  it('rejects an unresolvable repo path with a typed GitError for every guarded op', async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      const calls: Effect.Effect<unknown, unknown>[] = [
        client.commit({ repoPath: invalidRepo, message: 'x' }),
        client.discardAll({ repoPath: invalidRepo }),
        client.mergeBranch({ repoPath: invalidRepo, ref: 'main' }),
        client.revertCommit({ repoPath: invalidRepo, sha: 'HEAD' }),
        client.cherryPick({ repoPath: invalidRepo, sha: 'HEAD' }),
        client.checkout({ repoPath: invalidRepo, refKind: 'local', fullPath: 'main' }),
        client.createBranch({ repoPath: invalidRepo, name: 'b' }),
        client.deleteBranch({ repoPath: invalidRepo, name: 'x', force: false }),
        client.renameBranch({ repoPath: invalidRepo, oldName: 'a', newName: 'b' }),
        client.createTag({ repoPath: invalidRepo, name: 't' }),
        client.deleteTag({ repoPath: invalidRepo, name: 't' }),
        client.stashPop({ repoPath: invalidRepo, index: 0 }),
        client.stashApply({ repoPath: invalidRepo, index: 0 }),
        client.stashDrop({ repoPath: invalidRepo, index: 0 }),
        client.stashPush({ repoPath: invalidRepo }),
        client.reset({ repoPath: invalidRepo, sha: 'HEAD', mode: 'mixed' }),
        client.fetch({ repoPath: invalidRepo }),
        client.push({ repoPath: invalidRepo }),
        client.pull({ repoPath: invalidRepo }),
        client.getStatus({ repoPath: invalidRepo }),
        client.getBranches({ repoPath: invalidRepo }),
        client.getLocalBranches({ repoPath: invalidRepo }),
        client.getRemoteRefs({ repoPath: invalidRepo }),
        client.getLog({ repoPath: invalidRepo }),
        client.stashList({ repoPath: invalidRepo }),
        client.stageFile({ repoPath: invalidRepo, file: 'a.txt' }),
        client.unstageFile({ repoPath: invalidRepo, file: 'a.txt' }),
        client.stageHunk({ repoPath: invalidRepo, file: 'a.txt', hunkHeader: '@@ -1 +1 @@' }),
        client.unstageHunk({ repoPath: invalidRepo, file: 'a.txt', hunkHeader: '@@ -1 +1 @@' }),
        client.getDiff({ repoPath: invalidRepo, file: 'a.txt', staged: false }),
        client.stageAll({ repoPath: invalidRepo, files: ['a.txt'] }),
        client.unstageAll({ repoPath: invalidRepo, files: ['a.txt'] }),
        client.discardChanges({ repoPath: invalidRepo, files: ['a.txt'] })
      ]
      return yield* Effect.forEach(calls, (call) => Effect.either(call))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))

    const results = await Effect.runPromise(program)
    for (const result of results) {
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(GitError)
        expect((result.left as GitError).message).toBe('invalid repository path')
      }
    }
  })
})
