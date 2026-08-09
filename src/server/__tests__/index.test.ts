import { describe, expect, it } from 'vitest'
import { startServer } from '../index'

describe('Server composition root', () => {
  it('reports that standalone mode is unavailable until its runtime slice migrates', () => {
    expect(startServer).toThrow('Standalone Rebase Server mode has not been implemented yet')
  })
})
