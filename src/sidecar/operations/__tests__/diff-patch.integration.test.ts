import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseUnifiedDiff } from '@shared/unified-diff'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getDiff, openRepo } from '../index'

let repoDir: string
let modifiedSha: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function commit(message: string): string {
  git('-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', message)
  return git('rev-parse', 'HEAD').trim()
}

function write(file: string, contents: string): void {
  fs.writeFileSync(path.join(repoDir, file), contents)
}

beforeAll(async () => {
  repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-diff-patch-')))
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')

  write('sample.txt', 'alpha\nbravo\ncharlie\n')
  fs.writeFileSync(path.join(repoDir, 'logo.png'), Buffer.from([0, 1, 2, 3, 0, 255]))
  git('add', '-A')
  commit('base')

  write('sample.txt', 'alpha\nBRAVO\ncharlie\n')
  git('add', '-A')
  modifiedSha = commit('edit bravo')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(repoDir, { recursive: true, force: true })
})

describe('getDiff raw patch text', () => {
  it('returns the raw patch for a working-tree change', async () => {
    write('sample.txt', 'alpha\nBRAVO\nCHARLIE\n')

    const { patch } = await runOp(getDiff(repoDir, 'sample.txt', false))

    expect(patch).toContain('diff --git a/sample.txt b/sample.txt')
    expect(patch).toContain('@@ ')
    expect(patch).toContain('+CHARLIE')
    expect(parseUnifiedDiff(patch).hunks).toHaveLength(1)

    git('checkout', '--', 'sample.txt')
  })

  it('returns the raw patch for a staged change', async () => {
    write('sample.txt', 'alpha\nBRAVO\nDELTA\n')
    git('add', '--', 'sample.txt')

    const { patch } = await runOp(getDiff(repoDir, 'sample.txt', true))

    expect(patch).toContain('diff --git a/sample.txt b/sample.txt')
    expect(patch).toContain('+DELTA')

    git('reset', '-q', 'HEAD', '--', 'sample.txt')
    git('checkout', '--', 'sample.txt')
  })

  it('returns the raw patch for a commit', async () => {
    const { patch } = await runOp(getDiff(repoDir, 'sample.txt', false, { commit: modifiedSha }))

    expect(patch).toContain('diff --git a/sample.txt b/sample.txt')
    expect(patch).toContain('+BRAVO')
    expect(patch).toContain('-bravo')
  })

  it('returns the synthetic no-index patch for an untracked file', async () => {
    write('brand-new.txt', 'fresh\n')

    const { patch } = await runOp(getDiff(repoDir, 'brand-new.txt', false))

    expect(patch).toContain('new file mode')
    expect(patch).toContain('+fresh')

    fs.rmSync(path.join(repoDir, 'brand-new.txt'))
  })

  it('returns an empty patch for a clean file', async () => {
    const { patch } = await runOp(getDiff(repoDir, 'sample.txt', false))

    expect(patch).toBe('')
    expect(parseUnifiedDiff(patch).hunks).toEqual([])
  })

  it('keeps the binary flag as the only binary signal, with the patch alongside it', async () => {
    fs.writeFileSync(path.join(repoDir, 'logo.png'), Buffer.from([9, 8, 7, 0, 6]))

    const { patch, binary } = await runOp(getDiff(repoDir, 'logo.png', false))

    expect(binary).toBe(true)
    expect(parseUnifiedDiff(patch).hunks).toEqual([])
    expect(patch).toContain('Binary files ')

    git('checkout', '--', 'logo.png')
  })

  it('returns the --ours patch, never a combined diff, for an unresolved conflict', async () => {
    write('conflict.txt', 'base\n')
    git('add', '--', 'conflict.txt')
    commit('conflict base')
    git('checkout', '-q', '-b', 'conflict-side')
    write('conflict.txt', 'side\n')
    git('add', '--', 'conflict.txt')
    commit('side change')
    git('checkout', '-q', 'main')
    write('conflict.txt', 'main\n')
    git('add', '--', 'conflict.txt')
    commit('main change')
    expect(() => git('merge', 'conflict-side')).toThrow()

    try {
      const { patch } = await runOp(getDiff(repoDir, 'conflict.txt', false))

      expect(patch).not.toContain('@@@')
      expect(patch).toContain('@@ ')
      expect(patch).toContain('<<<<<<<')
    } finally {
      git('merge', '--abort')
    }
  })
})
