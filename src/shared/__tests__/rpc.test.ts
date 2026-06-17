import { GetDiff, GetLog, GetStatus } from '@shared/rpc'
import { Either, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
  Schema.decodeUnknownEither(schema)(value)

describe('RPC payload schemas', () => {
  it('accept a well-formed getStatus payload and reject malformed repoPath', () => {
    const schema = GetStatus.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo' }))).toBe(true)
    expect(Either.isLeft(decode(schema, {}))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '   ' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: 5 }))).toBe(true)
  })

  it('trims repoPath the same way the sidecar registry does', () => {
    const decoded = decode(GetStatus.payloadSchema, { repoPath: ' /repo ' })
    expect(Either.getOrUndefined(decoded)).toEqual({ repoPath: '/repo' })
  })

  it('reject an empty getDiff file field', () => {
    const schema = GetDiff.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', file: 'a.txt' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', file: '' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
  })

  it('reject a NaN getLog maxCount', () => {
    const schema = GetLog.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo' }))).toBe(true)
    expect(Either.isRight(decode(schema, { repoPath: '/repo', maxCount: 100 }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', maxCount: NaN }))).toBe(true)
  })
})
