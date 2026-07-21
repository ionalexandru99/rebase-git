import { Commit, StageFile } from '@shared/rpc'
import { rpcResultSchema } from '@shared/rpc-result'
import { Either, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

describe('rpcResultSchema', () => {
  it('caches one result schema per RPC contract', () => {
    expect(rpcResultSchema(Commit)).toBe(rpcResultSchema(Commit))
    expect(rpcResultSchema(Commit)).not.toBe(rpcResultSchema(StageFile))
  })

  it('derives success and domain-error wire variants from the contract', () => {
    const schema = rpcResultSchema(Commit)
    const success = Schema.decodeUnknownEither(schema)({
      _tag: 'Ok',
      result: {
        commit: 'abc123',
        branch: 'main',
        summary: { changes: 1, insertions: 1, deletions: 0 }
      }
    })
    const failure = Schema.decodeUnknownEither(schema)({
      _tag: 'GitError',
      message: 'nothing to commit'
    })

    expect(Either.isRight(success)).toBe(true)
    expect(Either.isRight(failure)).toBe(true)
  })
})
