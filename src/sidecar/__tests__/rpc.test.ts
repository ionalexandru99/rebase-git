import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { RepoNotOpen, SidecarRpcs } from '@shared/rpc'
import { Effect, Either, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSidecarServer } from '../server'

const TOKEN = 'rpc-test-token'
let baseUrl: string
let repoPath: string
let server: ReturnType<typeof createSidecarServer>

function git(cwd: string, args: string[]): void {
  const base =
    args[0] === 'commit' ? ['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign'] : args
  execFileSync('git', args[0] === 'commit' ? [...base, ...args.slice(1)] : base, {
    cwd,
    stdio: 'ignore'
  })
}

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-'))
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(repo, 'README.md'), '# hi\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', 'init'])
  return repo
}

const protocolLayer = () =>
  RpcClient.layerProtocolHttp({
    url: `${baseUrl}/rpc`,
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setHeader(request, 'authorization', `Bearer ${TOKEN}`)
      )
  }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerNdjson))

async function call(op: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${baseUrl}/op/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    throw new Error(`setup call failed: ${op} -> ${response.status} ${await response.text()}`)
  }
}

beforeAll(async () => {
  repoPath = makeRepo()
  server = createSidecarServer(TOKEN)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
  await call('open-repo', { repoPath })
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(repoPath, { recursive: true, force: true })
})

describe('sidecar RPC read ops', () => {
  it('returns a decoded status for an open repo over the /rpc transport', async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.getStatus({ repoPath }))
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
    const result = await Effect.runPromise(program)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.status.current).toBe('main')
    }
  })

  it('flows RepoNotOpen as a typed error, not a thrown string', async () => {
    const unopened = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-unopened-'))
    git(unopened, ['init', '-b', 'main'])
    try {
      const program = Effect.gen(function* () {
        const client = yield* RpcClient.make(SidecarRpcs)
        return yield* Effect.either(client.getStatus({ repoPath: unopened }))
      }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
      const result = await Effect.runPromise(program)
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect((result.left as { _tag: string })._tag).toBe('RepoNotOpen')
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      fs.rmSync(unopened, { recursive: true, force: true })
    }
  })
})
