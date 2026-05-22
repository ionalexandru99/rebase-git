import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SimpleGit } from 'simple-git'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from './instances'

describe('normalizeRepoPath', () => {
  it('strips trailing slashes', () => {
    expect(normalizeRepoPath('/tmp/repo/')).toBe('/tmp/repo')
  })

  it('collapses internal . and .. segments', () => {
    expect(normalizeRepoPath('/tmp/./repo/../repo')).toBe('/tmp/repo')
  })

  it('is idempotent', () => {
    const once = normalizeRepoPath('/tmp/repo/')
    expect(normalizeRepoPath(once)).toBe(once)
  })
})

describe('getOrCreateGit + lookupGit', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-instances-'))
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns the same instance for slash-variant paths', () => {
    const map = new Map<string, SimpleGit>()
    const a = getOrCreateGit(map, tmpDir)
    const b = getOrCreateGit(map, `${tmpDir}/`)
    expect(a).toBe(b)
    expect(map.size).toBe(1)
  })

  it('lookupGit finds an instance under a non-normalized key', () => {
    const map = new Map<string, SimpleGit>()
    const created = getOrCreateGit(map, tmpDir)
    expect(lookupGit(map, `${tmpDir}/`)).toBe(created)
    expect(lookupGit(map, `${tmpDir}/./`)).toBe(created)
  })

  it('lookupGit returns undefined for repos not in the map', () => {
    const map = new Map<string, SimpleGit>()
    expect(lookupGit(map, tmpDir)).toBeUndefined()
  })
})
