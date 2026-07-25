import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, openRepo, pushRepo } from '../index'

let remoteDir: string
let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-push-test-')))
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

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('pushRepo against a real repository', () => {
  it('pushes a branch that already has an upstream', async () => {
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'updated\n')
    git('commit', '-am', 'update')

    await runOp(pushRepo(repoDir))
    expect(git('rev-parse', 'main').trim()).toBe(git('rev-parse', 'origin/main').trim())
  })

  it('sets the upstream when pushing a branch missing on the remote', async () => {
    git('checkout', '-b', 'feature/no-upstream')
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'feature change\n')
    git('commit', '-am', 'feature change')

    await runOp(pushRepo(repoDir))
    expect(git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').trim()).toBe(
      'origin/feature/no-upstream'
    )

    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'second change\n')
    git('commit', '-am', 'second change')
    await runOp(pushRepo(repoDir))
    expect(git('rev-parse', 'feature/no-upstream').trim()).toBe(
      git('rev-parse', 'origin/feature/no-upstream').trim()
    )
  })

  it('pushes explicitly to a differently named configured upstream', async () => {
    git('checkout', '-b', 'local-name')
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'upstream base\n')
    git('commit', '-am', 'upstream base')
    git('push', '--set-upstream', 'origin', 'HEAD:remote-name')
    git('config', 'branch.local-name.merge', 'refs/heads/remote-name')
    git('config', 'push.default', 'simple')
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'upstream update\n')
    git('commit', '-am', 'upstream update')

    await runOp(pushRepo(repoDir))

    expect(git('rev-parse', 'local-name').trim()).toBe(
      git('rev-parse', 'origin/remote-name').trim()
    )
  })

  it('classifies the non-fast-forward porcelain wording', { timeout: 15000 }, async () => {
    git('checkout', '-b', 'diverging', 'main')
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'shared base\n')
    git('commit', '-am', 'shared base')
    git('push', '--set-upstream', 'origin', 'diverging')

    const teammateDir = path.join(path.dirname(repoDir), 'teammate')
    execFileSync('git', ['clone', '--branch', 'diverging', remoteDir, teammateDir])
    execFileSync('git', ['-C', teammateDir, 'config', 'user.email', 'other@example.com'])
    execFileSync('git', ['-C', teammateDir, 'config', 'user.name', 'Other'])
    fs.writeFileSync(path.join(teammateDir, 'file.txt'), 'teammate change\n')
    execFileSync('git', ['-C', teammateDir, 'commit', '-am', 'teammate change'])
    execFileSync('git', ['-C', teammateDir, 'push', 'origin', 'diverging'])

    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'local change\n')
    git('commit', '-am', 'local change')

    const outcome = await runOp(Effect.either(pushRepo(repoDir)))

    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe('PushRejected')
      if (outcome.left._tag === 'PushRejected') {
        expect(outcome.left.reason).toBe('non-fast-forward')
        expect(outcome.left.lostCommits).toEqual([])
        expect(outcome.left.remoteSha).toBeUndefined()
      }
    }
    expect(git('rev-parse', 'diverging').trim()).not.toBe(
      execFileSync('git', ['-C', teammateDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    )
  })
})
