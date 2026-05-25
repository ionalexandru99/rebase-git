import { describe, expect, it } from 'vitest'
import {
  clearValidatedScanRoots,
  storeValidatedScanRoot,
  takeValidatedScanRoot
} from '../scan-root-registry'

describe('scan-root-registry', () => {
  it('returns a stored path once by numeric id', () => {
    clearValidatedScanRoots()
    const id = storeValidatedScanRoot('/tmp/workspace')
    expect(takeValidatedScanRoot(id)).toBe('/tmp/workspace')
    expect(takeValidatedScanRoot(id)).toBeUndefined()
  })
})
