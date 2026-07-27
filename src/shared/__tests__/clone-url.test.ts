import { describe, expect, it } from 'vitest'
import { deriveCloneFolderName, isSafeCloneFolderName, isSupportedCloneUrl } from '../clone-url'

describe('isSupportedCloneUrl', () => {
  it('accepts the transports a desktop user clones with', () => {
    expect(isSupportedCloneUrl('https://github.com/owner/repo.git')).toBe(true)
    expect(isSupportedCloneUrl('http://internal.example/repo')).toBe(true)
    expect(isSupportedCloneUrl('ssh://git@github.com/owner/repo.git')).toBe(true)
    expect(isSupportedCloneUrl('git://example.com/repo.git')).toBe(true)
    expect(isSupportedCloneUrl('git@github.com:owner/repo.git')).toBe(true)
    expect(isSupportedCloneUrl('  https://github.com/owner/repo  ')).toBe(true)
  })

  it('rejects anything git could read as a flag, a local path, or two arguments', () => {
    expect(isSupportedCloneUrl('--upload-pack=rm -rf /')).toBe(false)
    expect(isSupportedCloneUrl('-c core.pager=x')).toBe(false)
    expect(isSupportedCloneUrl('/etc/passwd')).toBe(false)
    expect(isSupportedCloneUrl('https://example.com/repo extra-arg')).toBe(false)
    expect(isSupportedCloneUrl('https://example.com/re\0po')).toBe(false)
    expect(isSupportedCloneUrl('')).toBe(false)
    expect(isSupportedCloneUrl('github.com/owner/repo')).toBe(false)
  })
})

describe('deriveCloneFolderName', () => {
  it('names the folder git itself would create', () => {
    expect(deriveCloneFolderName('https://github.com/owner/repo.git')).toBe('repo')
    expect(deriveCloneFolderName('https://github.com/owner/repo')).toBe('repo')
    expect(deriveCloneFolderName('https://github.com/owner/repo/')).toBe('repo')
    expect(deriveCloneFolderName('git@github.com:owner/my-repo.git')).toBe('my-repo')
    expect(deriveCloneFolderName('ssh://git@host:2222/owner/repo.git')).toBe('repo')
    expect(deriveCloneFolderName('https://example.com/repo.git?ref=main')).toBe('repo')
  })

  it('returns null when no usable folder name can be read from the URL', () => {
    expect(deriveCloneFolderName('')).toBeNull()
    expect(deriveCloneFolderName('https://github.com/owner/..')).toBeNull()
    expect(deriveCloneFolderName('https://github.com/owner/-repo')).toBeNull()
  })
})

describe('isSafeCloneFolderName', () => {
  it('accepts a plain single path segment', () => {
    expect(isSafeCloneFolderName('repo')).toBe(true)
    expect(isSafeCloneFolderName('my.repo-2')).toBe(true)
  })

  it('rejects traversal, separators, hidden names, and flag-like names', () => {
    for (const name of ['', '.', '..', '.git', '-force', 'a/b', 'a\\b', 'a\0b']) {
      expect(isSafeCloneFolderName(name)).toBe(false)
    }
  })
})
