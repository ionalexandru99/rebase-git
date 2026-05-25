import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPathWithinDirectory,
  resolveExistingDirectory,
  resolveRepoRelativeFile
} from '../path-guards'

describe('resolveExistingDirectory', () => {
  it('returns the canonical path for an existing directory', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-scan-'))
    try {
      expect(resolveExistingDirectory(directory)).toBe(fs.realpathSync.native(directory))
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects parent-directory traversal segments', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-scan-parent-'))
    try {
      expect(resolveExistingDirectory(`${parent}/../../etc`)).toBeNull()
      expect(resolveExistingDirectory(`${parent}/child/../../etc`)).toBeNull()
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('rejects relative paths and non-directories', () => {
    const file = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-scan-file-'))
    const filePath = path.join(file, 'not-a-dir.txt')
    fs.writeFileSync(filePath, 'x')
    try {
      expect(resolveExistingDirectory('')).toBeNull()
      expect(resolveExistingDirectory('relative/workspace')).toBeNull()
      expect(resolveExistingDirectory(filePath)).toBeNull()
    } finally {
      fs.rmSync(file, { recursive: true, force: true })
    }
  })
})

describe('resolveRepoRelativeFile', () => {
  it('keeps paths inside the repository root', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-repo-file-'))
    try {
      expect(resolveRepoRelativeFile(repo, 'src/main.ts')).toBe(path.join('src', 'main.ts'))
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it('rejects traversal and absolute file paths', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-repo-traverse-'))
    try {
      expect(resolveRepoRelativeFile(repo, '../outside.txt')).toBeNull()
      expect(resolveRepoRelativeFile(repo, path.join(repo, 'inside.txt'))).toBeNull()
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('assertPathWithinDirectory', () => {
  it('accepts the directory itself and direct children', () => {
    expect(assertPathWithinDirectory('/repo', '/repo')).toBe(true)
    expect(assertPathWithinDirectory('/repo', '/repo/src/main.ts')).toBe(true)
    expect(assertPathWithinDirectory('/repo', '/reposibling')).toBe(false)
  })

  it('rejects traversal segments after normalization', () => {
    expect(assertPathWithinDirectory('/repo', '/repo/../etc')).toBe(false)
  })
})
