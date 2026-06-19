import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo, openRepo, pushRepo } from '../operations'

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

  await Effect.runPromise(openRepo(repoDir))
})

afterAll(async () => {
  await Effect.runPromise(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('pushRepo against a real repository', () => {
  it('pushes a branch that already has an upstream', async () => {
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'updated\n')
    git('commit', '-am', 'update')

    await Effect.runPromise(pushRepo(repoDir))
    expect(git('rev-parse', 'main').trim()).toBe(git('rev-parse', 'origin/main').trim())
  })

  it('sets the upstream when pushing a branch missing on the remote', async () => {
    git('checkout', '-b', 'feature/no-upstream')
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'feature change\n')
    git('commit', '-am', 'feature change')

    await Effect.runPromise(pushRepo(repoDir))
    expect(git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').trim()).toBe(
      'origin/feature/no-upstream'
    )

    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'second change\n')
    git('commit', '-am', 'second change')
    await Effect.runPromise(pushRepo(repoDir))
    expect(git('rev-parse', 'feature/no-upstream').trim()).toBe(
      git('rev-parse', 'origin/feature/no-upstream').trim()
    )
  })
})
