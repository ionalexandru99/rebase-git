import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getLocalBranches, getRemoteRefs, openRepo } from '../index'

let remoteDir: string
let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return predicate()
}

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-branch-test-')))
  remoteDir = path.join(base, 'remote.git')
  repoDir = path.join(base, 'clone')
  fs.mkdirSync(remoteDir)
  execFileSync('git', ['-C', remoteDir, 'init', '--bare', '-b', 'main'])
  execFileSync('git', ['clone', remoteDir, repoDir])
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repoDir, 'file.txt'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('push', '--set-upstream', 'origin', 'main')
  git('tag', 'v1.0')
  git('branch', 'feature/extra')
  fs.writeFileSync(path.join(repoDir, 'file.txt'), 'ahead\n')
  git('commit', '-am', 'ahead of origin')
  git('remote', 'set-head', 'origin', '--auto')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('branch listing against a real repository', () => {
  it('lists local branches with the current branch and ahead counts', async () => {
    const result = await runOp(getLocalBranches(repoDir))
    expect(result.branches.current).toBe('main')
    expect(result.branches.all).toEqual(['feature/extra', 'main'])
    expect(result.branches.tracking).toEqual({ main: { ahead: 1, behind: 0 } })
  })

  it('lists remote branches and tags, skipping the origin/HEAD symref', async () => {
    const result = await runOp(getRemoteRefs(repoDir))
    expect(result.refs.remotes).toEqual(['origin/main'])
    expect(result.refs.tags).toEqual(['v1.0'])
  })

  it('writes a commit-graph in the background after open', async () => {
    const graphDir = path.join(repoDir, '.git', 'objects', 'info')
    const hasGraph = () =>
      fs.existsSync(path.join(graphDir, 'commit-graph')) ||
      fs.existsSync(path.join(graphDir, 'commit-graphs'))
    expect(await waitFor(hasGraph)).toBe(true)
  })
})
