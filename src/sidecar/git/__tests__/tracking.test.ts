import { describe, expect, it } from 'vitest'
import { parseAheadBehind } from '../tracking'

describe('parseAheadBehind', () => {
  it('parses both ahead and behind on the same branch', () => {
    const raw = 'main|[ahead 2, behind 1]\n'
    expect(parseAheadBehind(raw)).toEqual({ main: { ahead: 2, behind: 1 } })
  })

  it('parses ahead-only and behind-only', () => {
    const raw = 'feature/foo|[ahead 5]\ndevelop|[behind 3]\n'
    expect(parseAheadBehind(raw)).toEqual({
      'feature/foo': { ahead: 5, behind: 0 },
      develop: { ahead: 0, behind: 3 }
    })
  })

  it('omits branches in sync with their upstream', () => {
    const raw = 'main|\nclean|[ahead 0]\n'
    expect(parseAheadBehind(raw)).toEqual({})
  })

  it('omits branches with no upstream', () => {
    const raw = 'local-only|\n'
    expect(parseAheadBehind(raw)).toEqual({})
  })

  it('omits branches whose upstream is gone', () => {
    const raw = 'orphan|[gone]\n'
    expect(parseAheadBehind(raw)).toEqual({})
  })

  it('handles trailing whitespace and blank lines', () => {
    const raw = '\nmain|[ahead 2]\n\nfeature|[behind 1]   \n'
    expect(parseAheadBehind(raw)).toEqual({
      main: { ahead: 2, behind: 0 },
      feature: { ahead: 0, behind: 1 }
    })
  })

  it('keeps branch names that contain slashes intact', () => {
    const raw = 'feature/a/b/c|[ahead 4, behind 2]\n'
    expect(parseAheadBehind(raw)).toEqual({ 'feature/a/b/c': { ahead: 4, behind: 2 } })
  })
})
