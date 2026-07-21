import { describe, expect, it } from 'vitest'
import { unwrapOk } from '@/lib/unwrap-rpc-result'

describe('unwrapOk', () => {
  it('returns the typed Ok payload', () => {
    expect(unwrapOk({ _tag: 'Ok' as const, value: 3 }).value).toBe(3)
  })

  it('turns common domain failures into query errors', () => {
    expect(() => unwrapOk({ _tag: 'GitError', message: 'index locked' })).toThrow('index locked')
    expect(() => unwrapOk({ _tag: 'RepoNotOpen' })).toThrow('Repository not open')
  })
})
