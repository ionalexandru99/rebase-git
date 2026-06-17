import { SidecarOp } from '@shared/sidecar-ops'
import { sidecarRegistry } from '@shared/sidecar-registry'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

describe('sidecarRegistry', () => {
  it('has a request and response schema for every SidecarOp', () => {
    for (const op of Object.values(SidecarOp)) {
      expect(sidecarRegistry[op]).toBeDefined()
      expect(sidecarRegistry[op].request).toBeDefined()
      expect(sidecarRegistry[op].response).toBeDefined()
    }
  })

  it('has no entries beyond the SidecarOp allowlist', () => {
    const allowed = new Set<string>(Object.values(SidecarOp))
    for (const key of Object.keys(sidecarRegistry)) {
      expect(allowed.has(key)).toBe(true)
    }
  })

  it('accepts a well-formed request and rejects a malformed one', () => {
    const decode = Schema.decodeUnknownEither(sidecarRegistry[SidecarOp.getStatus].request)
    expect(decode({ repoPath: '/repo' })._tag).toBe('Right')
    expect(decode({})._tag).toBe('Left')
    expect(decode({ repoPath: '   ' })._tag).toBe('Left')
  })
})
