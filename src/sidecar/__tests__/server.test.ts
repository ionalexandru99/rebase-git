import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createConnection } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { RepoNotOpen } from '@shared/git-rpc-errors'
import { SidecarRpcs } from '@shared/rpc'
import { Effect, Either, Fiber, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSidecarServer } from '../server'
import { killIfAlive, processAlive, waitUntil } from './hanging-git'

const TOKEN = 'test-token'
let baseUrl: string
let repoPath: string
let server: ReturnType<typeof createSidecarServer>

function git(cwd: string, args: string[]): string {
  const commandArgs =
    args[0] === 'commit'
      ? [
          '-c',
          'commit.gpgsign=false',
          '-c',
          'gc.auto=0',
          'commit',
          '--no-gpg-sign',
          ...args.slice(1)
        ]
      : args
  return execFileSync('git', commandArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
}

async function call(op: string, body: Record<string, unknown>, token = TOKEN): Promise<Response> {
  return fetch(`${baseUrl}/op/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
}

function rawRequest(target: string, authorization?: string): Promise<string> {
  const { hostname, port } = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = createConnection(Number(port), hostname, () => {
      const authHeader = authorization ? `Authorization: ${authorization}\r\n` : ''
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: ${hostname}:${port}\r\n${authHeader}Connection: close\r\n\r\n`
      )
    })
    socket.setTimeout(1000, () => {
      socket.destroy()
      reject(new Error('raw request timed out'))
    })
    socket.on('data', (chunk) => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    socket.on('error', reject)
  })
}

const rpcProtocolLayer = () =>
  RpcClient.layerProtocolHttp({
    url: `${baseUrl}/rpc`,
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setHeader(request, 'authorization', `Bearer ${TOKEN}`)
      )
  }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerNdjson))

function rpcCommit(repoPath: string, message: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.commit({ repoPath, message }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

function rpcStageFile(repoPath: string, file: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.stageFile({ repoPath, file }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

function rpcStageAll(repoPath: string, files: string[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.stageAll({ repoPath, files }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

function rpcUnstageAll(repoPath: string, files: string[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.unstageAll({ repoPath, files }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

function rpcPush(repoPath: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.push({ repoPath }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

function rpcPull(repoPath: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.pull({ repoPath }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

function rpcGetStatus(repoPath: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.getStatus({ repoPath }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

function rpcGetLocalBranches(repoPath: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.getLocalBranches({ repoPath }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

function rpcGetRemoteRefs(repoPath: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.getRemoteRefs({ repoPath }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
}

async function rpcOpenRepo(repoPath: string): Promise<void> {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.openRepo({ repoPath }))
    }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
  )
  if (Either.isLeft(result)) {
    throw new Error(`open-repo setup failed: ${JSON.stringify(result.left)}`)
  }
}

beforeAll(async () => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-sidecar-'))
  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 'test@example.com'])
  git(repoPath, ['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# hello\n')
  git(repoPath, ['add', '.'])
  git(repoPath, ['commit', '-m', 'initial'])

  server = createSidecarServer(TOKEN)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
  await rpcOpenRepo(repoPath)
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(repoPath, { recursive: true, force: true })
})

describe('sidecar server', () => {
  it('serves health with auth', async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(response.ok).toBe(true)
  })

  it('rejects health without a valid token', async () => {
    const response = await fetch(`${baseUrl}/health`)
    expect(response.status).toBe(401)
  })

  it('authenticates before parsing a malformed request target and remains healthy', async () => {
    const unauthorized = await rawRequest('http://[')
    expect(unauthorized).toContain('HTTP/1.1 401 Unauthorized')

    const malformed = await rawRequest('http://[', `Bearer ${TOKEN}`)
    expect(malformed).toContain('HTTP/1.1 400 Bad Request')

    const health = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(health.status).toBe(200)
  })

  it('rejects rpc requests without a valid token', async () => {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/ndjson', authorization: 'Bearer wrong' },
      body: ''
    })
    expect(response.status).toBe(401)
  })

  it('returns RepoNotOpen for status before open', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-unopened-'))
    const status = await rpcGetStatus(other)
    expect(Either.isLeft(status)).toBe(true)
    if (Either.isLeft(status)) {
      expect(status.left).toBeInstanceOf(RepoNotOpen)
    }
    fs.rmSync(other, { recursive: true, force: true })
  })

  it('reports status after a file change', async () => {
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'content\n')
    const status = await rpcGetStatus(repoPath)
    expect(Either.isRight(status)).toBe(true)
    if (Either.isRight(status)) {
      expect(status.right.status.not_added).toContain('new.txt')
    }
  })

  it('terminates a nonlocked SimpleGit read when its RPC request is cancelled', async () => {
    const hangingRepo = createHangingStatusRepo()
    await rpcOpenRepo(hangingRepo.repoPath)
    let filterPid: number | undefined

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(SidecarRpcs)
          const request = yield* Effect.fork(client.getStatus({ repoPath: hangingRepo.repoPath }))
          yield* Effect.promise(() =>
            waitUntil(() => hangingRepo.filterPid() !== undefined, 10_000, 'clean filter start')
          )
          filterPid = hangingRepo.filterPid()
          yield* Fiber.interrupt(request)
        }).pipe(Effect.scoped, Effect.provide(rpcProtocolLayer()))
      )

      expect(filterPid).toBeDefined()
      await waitUntil(() => !processAlive(filterPid), 10_000, 'clean filter exit')
    } finally {
      killIfAlive(hangingRepo.filterPid())
      hangingRepo.cleanup()
    }
  }, 30_000)

  it('stages and commits through /rpc', async () => {
    const staged = await rpcStageFile(repoPath, 'new.txt')
    expect(Either.isRight(staged)).toBe(true)

    const committed = await rpcCommit(repoPath, 'add new.txt')
    expect(Either.isRight(committed)).toBe(true)
    if (Either.isRight(committed)) {
      expect(committed.right.result.commit).toBeTruthy()
    }

    expect(git(repoPath, ['log', '-1', '--format=%s']).trim()).toBe('add new.txt')
  })

  it('stages and unstages many files in one call', async () => {
    fs.writeFileSync(path.join(repoPath, 'one.txt'), 'one\n')
    fs.writeFileSync(path.join(repoPath, 'two.txt'), 'two\n')

    const staged = await rpcStageAll(repoPath, ['one.txt', 'two.txt'])
    expect(Either.isRight(staged)).toBe(true)

    const afterStage = await rpcGetStatus(repoPath)
    expect(Either.isRight(afterStage)).toBe(true)
    if (Either.isRight(afterStage)) {
      expect(afterStage.right.status.staged).toEqual(expect.arrayContaining(['one.txt', 'two.txt']))
    }

    const unstaged = await rpcUnstageAll(repoPath, ['one.txt', 'two.txt'])
    expect(Either.isRight(unstaged)).toBe(true)

    const afterUnstage = await rpcGetStatus(repoPath)
    expect(Either.isRight(afterUnstage)).toBe(true)
    if (Either.isRight(afterUnstage)) {
      expect(afterUnstage.right.status.staged).not.toEqual(
        expect.arrayContaining(['one.txt', 'two.txt'])
      )
      expect(afterUnstage.right.status.not_added).toEqual(
        expect.arrayContaining(['one.txt', 'two.txt'])
      )
    }
  })

  it('returns RepoNotOpen for push and pull before open', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-unopened-'))
    const pushed = await rpcPush(other)
    const pulled = await rpcPull(other)
    expect(Either.isLeft(pushed)).toBe(true)
    expect(Either.isLeft(pulled)).toBe(true)
    if (Either.isLeft(pushed)) {
      expect(pushed.left).toBeInstanceOf(RepoNotOpen)
    }
    if (Either.isLeft(pulled)) {
      expect(pulled.left).toBeInstanceOf(RepoNotOpen)
    }
    fs.rmSync(other, { recursive: true, force: true })
  })

  describe('push and pull', () => {
    let remote: string
    let clone: string
    let downstream: string

    beforeAll(async () => {
      remote = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-remote-'))
      execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' })

      clone = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-clone-'))
      execFileSync('git', ['clone', remote, clone], { stdio: 'ignore' })
      git(clone, ['config', 'user.email', 'test@example.com'])
      git(clone, ['config', 'user.name', 'Test'])
      fs.writeFileSync(path.join(clone, 'a.txt'), 'a\n')
      git(clone, ['add', '.'])
      git(clone, ['commit', '-m', 'first'])
      git(clone, ['push', '-u', 'origin', 'main'])

      downstream = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-downstream-'))
      execFileSync('git', ['clone', remote, downstream], { stdio: 'ignore' })

      fs.writeFileSync(path.join(clone, 'b.txt'), 'b\n')
      git(clone, ['add', '.'])
      git(clone, ['commit', '-m', 'second'])
      await rpcOpenRepo(clone)
      await rpcOpenRepo(downstream)
    })

    afterAll(() => {
      for (const dir of [remote, clone, downstream]) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it('pushes a commit to its upstream and pulls it into another clone', async () => {
      const pushed = await rpcPush(clone)
      expect(Either.isRight(pushed)).toBe(true)

      const pulled = await rpcPull(downstream)
      expect(Either.isRight(pulled)).toBe(true)

      const subject = execFileSync('git', ['log', '-1', '--format=%s'], {
        cwd: downstream,
        encoding: 'utf8'
      })
      expect(subject.trim()).toBe('second')
    }, 5_000)
  })

  it('lists local branches separately', async () => {
    const branches = await rpcGetLocalBranches(repoPath)
    expect(Either.isRight(branches)).toBe(true)
    if (Either.isRight(branches)) {
      expect(branches.right.branches.current).toBe('main')
      expect(branches.right.branches.all).toContain('main')
    }
  })

  it('lists remote refs separately', async () => {
    const refs = await rpcGetRemoteRefs(repoPath)
    expect(Either.isRight(refs)).toBe(true)
    if (Either.isRight(refs)) {
      expect(refs.right.refs.remotes).toEqual([])
      expect(refs.right.refs.tags).toEqual([])
    }
  })

  it('does not expose the old op endpoint for operations', async () => {
    const response = await call('get-status', { repoPath })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found' })
  })

  it('returns 413 when an rpc request body exceeds the size limit', async () => {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/ndjson', authorization: `Bearer ${TOKEN}` },
      body: `{"repoPath":${JSON.stringify('x'.repeat(1024 * 1024 + 1))}}`
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload too large' })
  })

  it('rejects an authenticated CORS preflight with 403', async () => {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'OPTIONS',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, b3, traceparent',
        'access-control-request-private-network': 'true'
      }
    })
    expect(response.status).toBe(403)
  })

  it('rejects an unauthenticated preflight with 401 before reaching OPTIONS handling', async () => {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST'
      }
    })
    expect(response.status).toBe(401)
  })

  it('does not include wildcard CORS headers on sidecar responses', async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

interface HangingStatusRepo {
  repoPath: string
  filterPid: () => number | undefined
  cleanup: () => void
}

// A repo whose `git status` blocks forever inside a real descendant process, so the RPC's SimpleGit
// child can be observed dying with its tree. git runs a clean filter through a shell on every
// platform — unlike a PATH shim, which Win32 cannot execute by bare name. git only reaches for the
// filter when it has to hash a tracked file to decide whether it changed, and it only has to do that
// when the worktree file's size still matches the index, hence the same-length dirty content.
function createHangingStatusRepo(): HangingStatusRepo {
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-read-cancel-'))
  )
  const repoPath = path.join(dir, 'repo')
  const pidPath = path.join(dir, 'filter-pid')
  const filterScript = path.join(dir, 'clean-filter.mjs')
  fs.writeFileSync(
    filterScript,
    [
      "import fs from 'node:fs'",
      'fs.writeFileSync(process.argv[2], String(process.pid))',
      'process.stdin.resume()',
      'setInterval(() => {}, 1 << 30)',
      ''
    ].join('\n')
  )

  fs.mkdirSync(repoPath)
  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 'test@example.com'])
  git(repoPath, ['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(repoPath, 'tracked.txt'), 'hello\n')
  git(repoPath, ['add', '.'])
  git(repoPath, ['commit', '-m', 'initial'])

  const toShellPath = (value: string) => `"${value.replace(/\\/g, '/')}"`
  git(repoPath, [
    'config',
    'filter.hang.clean',
    `${toShellPath(process.execPath)} ${toShellPath(filterScript)} ${toShellPath(pidPath)}`
  ])
  fs.writeFileSync(path.join(repoPath, '.gitattributes'), 'tracked.txt filter=hang\n')
  fs.writeFileSync(path.join(repoPath, 'tracked.txt'), 'world\n')

  return {
    repoPath,
    filterPid: () => {
      if (!fs.existsSync(pidPath)) {
        return undefined
      }
      const raw = fs.readFileSync(pidPath, 'utf8').trim()
      return /^\d+$/.test(raw) ? Number(raw) : undefined
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
}
