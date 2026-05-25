import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveScanDirectory } from '../repo-path'

describe('resolveScanDirectory', () => {
  it('returns the canonical path for an existing directory', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-scan-'))
    try {
      expect(resolveScanDirectory(directory)).toBe(fs.realpathSync.native(directory))
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects parent-directory traversal segments', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-scan-parent-'))
    try {
      expect(resolveScanDirectory(`${parent}/../../etc`)).toBeNull()
      expect(resolveScanDirectory(`${parent}/child/../../etc`)).toBeNull()
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects relative paths', () => {
    expect(resolveScanDirectory('relative/workspace')).toBeNull()
  })

  it('rejects empty paths and non-directories', () => {
    const file = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-scan-file-'))
    const filePath = path.join(file, 'not-a-dir.txt')
    fs.writeFileSync(filePath, 'x')
    try {
      expect(resolveScanDirectory('')).toBeNull()
      expect(resolveScanDirectory(filePath)).toBeNull()
    } finally {
      fs.rmSync(file, { recursive: true, force: true })
    }
  })
})
