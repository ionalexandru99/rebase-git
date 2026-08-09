import {
  EnvironmentIdSchema,
  EnvironmentPathRefSchema,
  RepoRefSchema
} from '../../../src/common/features/repository-identity'
import { Result, Schema } from 'effect4'
import { describe, expect, it } from 'vitest'

const localEnvironmentId = EnvironmentIdSchema.make('local')

describe('Repository identity', () => {
  it('round-trips Environment-qualified wire facts', () => {
    const repoRef = {
      environmentId: localEnvironmentId,
      path: '/workspace/rebase'
    }

    expect(Schema.encodeUnknownSync(Schema.toCodecJson(RepoRefSchema))(repoRef)).toEqual(
      repoRef
    )
    expect(
      Schema.decodeUnknownSync(Schema.toCodecJson(EnvironmentPathRefSchema))({
        environmentId: 'remote',
        path: '/scan/root'
      })
    ).toEqual({ environmentId: 'remote', path: '/scan/root' })
  })

  it('rejects empty and oversized identity fields', () => {
    const emptyEnvironment = Schema.decodeUnknownResult(RepoRefSchema)({
      environmentId: '',
      path: '/workspace/rebase'
    })
    const emptyPath = Schema.decodeUnknownResult(RepoRefSchema)({
      environmentId: 'local',
      path: ''
    })
    const oversizedPath = Schema.decodeUnknownResult(RepoRefSchema)({
      environmentId: 'local',
      path: 'x'.repeat(4097)
    })

    expect(Result.isFailure(emptyEnvironment)).toBe(true)
    expect(Result.isFailure(emptyPath)).toBe(true)
    expect(Result.isFailure(oversizedPath)).toBe(true)
  })

})
