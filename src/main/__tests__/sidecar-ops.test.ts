import { SidecarOp } from '@shared/sidecar-ops'
import { describe, expect, it } from 'vitest'

describe('SidecarOp allowlist', () => {
  it('includes split branch loading ops', () => {
    expect(Object.values(SidecarOp)).toContain('get-local-branches')
    expect(Object.values(SidecarOp)).toContain('get-remote-refs')
  })
})
