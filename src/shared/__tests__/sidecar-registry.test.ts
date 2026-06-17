import { Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { parseEither } from '../codec'
import { SidecarRpcs } from '../rpc'
import { SidecarOp } from '../sidecar-ops'
import { sidecarRegistry } from '../sidecar-registry'

describe('sidecarRegistry', () => {
  it('has one contract entry per sidecar operation', () => {
    expect(Object.keys(sidecarRegistry).sort()).toEqual(Object.values(SidecarOp).sort())
  })

  it('validates request bodies by operation', () => {
    const valid = parseEither(sidecarRegistry[SidecarOp.stageFile].request, {
      repoPath: '/repo',
      file: 'src/app.ts'
    })
    const invalid = parseEither(sidecarRegistry[SidecarOp.stageFile].request, {
      repoPath: '/repo'
    })

    expect(Either.isRight(valid)).toBe(true)
    expect(Either.isLeft(invalid)).toBe(true)
  })

  it('exposes the registry as an Effect RPC group', () => {
    expect(SidecarRpcs).toBeDefined()
  })
})
