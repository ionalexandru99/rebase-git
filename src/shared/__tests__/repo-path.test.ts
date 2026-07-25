import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { tabResourceKey } from '../repo-path'

describe('tabResourceKey', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => {
    while (cleanup.length > 0) {
      cleanup.pop()?.()
    }
  })

  it('normalizes the repo path so a `..` segment collapses into the key', () => {
    expect(tabResourceKey(1, '/repo/nested/../worktree')).toBe(
      `1:${path.resolve('/repo/worktree')}`
    )
  })

  it('keys the same filesystem location identically however the path is written', () => {
    expect(tabResourceKey(1, '/a/b')).toBe(tabResourceKey(1, '/a/c/../b'))
  })

  it('partitions by webContentsId', () => {
    expect(tabResourceKey(1, '/a/b')).not.toBe(tabResourceKey(2, '/a/b'))
  })

  it('keys a symlinked repo path the same as its real path', () => {
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-tabkey-'))
    const linkDir = `${realDir}-link`
    fs.symlinkSync(realDir, linkDir)
    cleanup.push(() => fs.rmSync(linkDir, { force: true }))
    cleanup.push(() => fs.rmSync(realDir, { recursive: true, force: true }))
    expect(tabResourceKey(7, linkDir)).toBe(tabResourceKey(7, realDir))
  })
})
