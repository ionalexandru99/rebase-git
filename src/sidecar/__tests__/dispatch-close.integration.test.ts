import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SidecarOp } from '@shared/sidecar-ops'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../dispatch'

let baseDir: string
let repoDir: string

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args])
}

beforeEach(() => {
  baseDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-dispatch-test-')))
  repoDir = path.join(baseDir, 'repo')
  fs.mkdirSync(repoDir)
  git(repoDir, 'init', '-b', 'main')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n')
  git(repoDir, 'add', 'README.md')
  git(repoDir, 'commit', '-m', 'initial')
})

afterEach(async () => {
  await dispatch(SidecarOp.closeRepo, { repoPath: repoDir })
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('dispatch closeRepo wire folding', () => {
  it('returns the Ok wire envelope after opening', async () => {
    await dispatch(SidecarOp.openRepo, { repoPath: repoDir })
    const result = await dispatch(SidecarOp.closeRepo, { repoPath: repoDir })
    expect(result).toEqual({ _tag: 'Ok' })
  })

  it('returns the Ok wire envelope for a repo that was never opened', async () => {
    const result = await dispatch(SidecarOp.closeRepo, { repoPath: repoDir })
    expect(result).toEqual({ _tag: 'Ok' })
  })
})
