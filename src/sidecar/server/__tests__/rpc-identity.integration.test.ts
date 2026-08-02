import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { SidecarRpcs } from '@shared/rpc'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { handlersLayer } from '../handlers'

let workDir: string
let repoDir: string
let globalConfigPath: string
const previousEnv: Record<string, string | undefined> = {}

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
}

function globalConfig(...args: string[]): void {
  execFileSync('git', ['config', '--global', ...args], { stdio: 'ignore' })
}

const getIdentity = (payload: { repoPath?: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.getIdentity(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const setIdentity = (payload: {
  scope: 'global' | 'local'
  repoPath?: string
  name?: string
  email?: string
}) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.setIdentity(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const clearIdentity = (payload: { repoPath: string; fields: ('name' | 'email')[] }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.clearIdentity(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const expectRight = <A, E>(result: Either.Either<A, E>): A => {
  if (Either.isLeft(result)) {
    throw new Error(`expected success, got ${JSON.stringify(result.left)}`)
  }
  return result.right
}

beforeAll(() => {
  workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-identity-')))
  globalConfigPath = path.join(workDir, 'gitconfig-global')
  fs.writeFileSync(globalConfigPath, '')
  for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) {
    previousEnv[key] = process.env[key]
  }
  process.env.GIT_CONFIG_GLOBAL = globalConfigPath
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  repoDir = path.join(workDir, 'repo')
  fs.mkdirSync(repoDir)
  git(repoDir, 'init', '-b', 'main')
})

afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  fs.rmSync(workDir, { recursive: true, force: true })
})

beforeEach(() => {
  fs.writeFileSync(globalConfigPath, '')
  fs.writeFileSync(path.join(repoDir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n')
})

describe('identity rpcs', () => {
  it('reports local, global, and effective identity for a repo', async () => {
    globalConfig('user.name', 'Global Name')
    globalConfig('user.email', 'global@example.com')
    git(repoDir, 'config', '--local', 'user.email', 'local@example.com')

    const identity = expectRight(await getIdentity({ repoPath: repoDir }))

    expect(identity).toEqual({
      local: { email: 'local@example.com' },
      global: { name: 'Global Name', email: 'global@example.com' },
      effective: { name: 'Global Name', email: 'local@example.com' }
    })
  })

  it('reports the global identity as effective when there is no repo', async () => {
    globalConfig('user.name', 'Global Name')
    globalConfig('user.email', 'global@example.com')

    const identity = expectRight(await getIdentity({}))

    expect(identity).toEqual({
      local: {},
      global: { name: 'Global Name', email: 'global@example.com' },
      effective: { name: 'Global Name', email: 'global@example.com' }
    })
  })

  it('writes a per-field repo-local override and leaves the global identity alone', async () => {
    globalConfig('user.name', 'Global Name')
    globalConfig('user.email', 'global@example.com')

    expectRight(
      await setIdentity({ scope: 'local', repoPath: repoDir, email: 'local@example.com' })
    )

    const identity = expectRight(await getIdentity({ repoPath: repoDir }))
    expect(identity.local).toEqual({ email: 'local@example.com' })
    expect(identity.global).toEqual({ name: 'Global Name', email: 'global@example.com' })
    expect(identity.effective).toEqual({ name: 'Global Name', email: 'local@example.com' })
  })

  it('sets the global identity without a repo', async () => {
    expectRight(await setIdentity({ scope: 'global', name: 'New Name', email: 'new@example.com' }))

    const identity = expectRight(await getIdentity({}))
    expect(identity.global).toEqual({ name: 'New Name', email: 'new@example.com' })
  })

  it('rejects a whitespace-only value and keeps the stored identity', async () => {
    globalConfig('user.name', 'Global Name')

    const result = await setIdentity({ scope: 'global', name: '   ' })

    expect(Either.isLeft(result)).toBe(true)
    const identity = expectRight(await getIdentity({}))
    expect(identity.global.name).toBe('Global Name')
  })

  it('clears one repo-local override back to the inherited global value', async () => {
    globalConfig('user.name', 'Global Name')
    globalConfig('user.email', 'global@example.com')
    expectRight(
      await setIdentity({
        scope: 'local',
        repoPath: repoDir,
        name: 'Local Name',
        email: 'local@example.com'
      })
    )

    expectRight(await clearIdentity({ repoPath: repoDir, fields: ['email'] }))

    const identity = expectRight(await getIdentity({ repoPath: repoDir }))
    expect(identity.local).toEqual({ name: 'Local Name' })
    expect(identity.effective).toEqual({ name: 'Local Name', email: 'global@example.com' })
  })

  it('clears an override that was never set', async () => {
    globalConfig('user.name', 'Global Name')

    expectRight(await clearIdentity({ repoPath: repoDir, fields: ['name', 'email'] }))

    const identity = expectRight(await getIdentity({ repoPath: repoDir }))
    expect(identity.local).toEqual({})
    expect(identity.effective).toEqual({ name: 'Global Name' })
  })
})
