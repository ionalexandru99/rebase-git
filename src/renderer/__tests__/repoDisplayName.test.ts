import { describe, expect, it } from 'vitest'
import { repoDisplayName } from '../lib/repoDisplayName'

describe('repoDisplayName', () => {
  it('returns Repository when path is missing', () => {
    expect(repoDisplayName(undefined)).toBe('Repository')
  })

  it('uses the last path segment on Unix paths', () => {
    expect(repoDisplayName('/home/user/my-repo')).toBe('my-repo')
  })

  it('uses the last path segment on Windows-style paths', () => {
    expect(repoDisplayName('C:\\Users\\user\\my-repo')).toBe('my-repo')
  })

  it('ignores trailing separators', () => {
    expect(repoDisplayName('/home/user/my-repo/')).toBe('my-repo')
    expect(repoDisplayName('C:\\Users\\user\\my-repo\\')).toBe('my-repo')
  })
})
