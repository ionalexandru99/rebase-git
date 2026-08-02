import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { RepoNotOpen, SidecarRpcs } from '@shared/rpc'
import { Effect, Either, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createRepoFixture,
  type RepoFixture,
  removeRepoDir,
  git as runGit
} from '../../test-support/repo-fixtures'
import { createSidecarServer } from '../http'

const TOKEN = 'rpc-test-token'
let baseUrl: string
let repoPath: string
let repo: RepoFixture
let server: ReturnType<typeof createSidecarServer>

const protocolLayer = () =>
  RpcClient.layerProtocolHttp({
    url: `${baseUrl}/rpc`,
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setHeader(request, 'authorization', `Bearer ${TOKEN}`)
      )
  }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerNdjson))

async function openRepo(repoPath: string): Promise<void> {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.openRepo({ repoPath }))
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
  )
  if (Either.isLeft(result)) {
    throw new Error(`open-repo setup failed: ${JSON.stringify(result.left)}`)
  }
}

async function closeRepo(repoPath: string): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* client.closeRepo({ repoPath })
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
  )
}

async function stageFile(repoPath: string, file: string): Promise<void> {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.stageFile({ repoPath, file }))
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
  )
  if (Either.isLeft(result)) {
    throw new Error(`stage-file setup failed: ${JSON.stringify(result.left)}`)
  }
}

beforeAll(async () => {
  repo = createRepoFixture({ prefix: 'rebase-rpc-' })
  repoPath = repo.path
  repo.write('README.md', '# hi\n')
  repo.git('add', '.')
  repo.commitStaged('init')
  server = createSidecarServer(TOKEN)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
  await openRepo(repoPath)
})

afterAll(async () => {
  await closeRepo(repoPath)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  repo.cleanup()
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
    runGit(unopened, ['init', '-b', 'main'])
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
      removeRepoDir(unopened)
    }
  })
})

describe('sidecar RPC write ops', () => {
  it('commits an open repo and returns a typed CommitSummary over the /rpc transport', async () => {
    fs.writeFileSync(path.join(repoPath, 'rpc-commit.txt'), 'content\n')
    await stageFile(repoPath, 'rpc-commit.txt')
    const program = Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.commit({ repoPath, message: 'rpc write commit' }))
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
    const result = await Effect.runPromise(program)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.result.commit).toBeTruthy()
      expect(result.right.result.summary.insertions).toBeGreaterThan(0)
    }
  })

  it('flows a commit RepoNotOpen as a typed error, not a thrown string', async () => {
    const unopened = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-commit-unopened-'))
    runGit(unopened, ['init', '-b', 'main'])
    try {
      const program = Effect.gen(function* () {
        const client = yield* RpcClient.make(SidecarRpcs)
        return yield* Effect.either(client.commit({ repoPath: unopened, message: 'nope' }))
      }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
      const result = await Effect.runPromise(program)
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      removeRepoDir(unopened)
    }
  })
})
