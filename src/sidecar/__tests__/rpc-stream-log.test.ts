import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { GitError, SidecarRpcs } from '@shared/rpc'
import type { LogChunk } from '@shared/schemas/git'
import { Chunk, Effect, Either, Fiber, Layer, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSidecarServer } from '../server'
import { makeBigRepo, makeRepo } from './repo-fixtures'

const TOKEN = 'rpc-stream-test-token'
let baseUrl: string
let repoPath: string
let bigRepoPath: string
let server: ReturnType<typeof createSidecarServer>

const protocolLayer = () =>
  RpcClient.layerProtocolHttp({
    url: `${baseUrl}/rpc`,
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setHeader(request, 'authorization', `Bearer ${TOKEN}`)
      )
  }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerNdjson))

async function openRepo(target: string): Promise<void> {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* Effect.either(client.openRepo({ repoPath: target }))
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
  )
  if (Either.isLeft(result)) {
    throw new Error(`open-repo setup failed: ${JSON.stringify(result.left)}`)
  }
}

function collectStreamLog(
  target: string,
  options?: { skip?: number; maxCount?: number }
): Promise<LogChunk[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      const chunks = yield* Stream.runCollect(
        client.streamLog({ repoPath: target, skip: options?.skip, maxCount: options?.maxCount })
      )
      return Chunk.toReadonlyArray(chunks) as LogChunk[]
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
  )
}

beforeAll(async () => {
  repoPath = makeRepo(['init', 'second', 'third'])
  bigRepoPath = makeBigRepo(4000)
  server = createSidecarServer(TOKEN)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
  await openRepo(repoPath)
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(repoPath, { recursive: true, force: true })
  fs.rmSync(bigRepoPath, { recursive: true, force: true })
})

function waitUntil(predicate: () => boolean): Effect.Effect<void> {
  return Effect.async<void>((resume) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      if (predicate()) {
        resume(Effect.void)
        return
      }
      timer = setTimeout(tick, 5)
    }
    tick()
    return Effect.sync(() => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    })
  })
}

describe('streamLog RPC over the /rpc transport', () => {
  it('delivers the full log in topo order, terminating with a done chunk', async () => {
    const chunks = await collectStreamLog(repoPath)
    const commits = chunks.flatMap((chunk) => chunk.commits)
    expect(commits.map((commit) => commit.message)).toEqual(['third', 'second', 'init'])
    expect(chunks.at(-1)?.done).toBe(true)
  })

  it('reports hasMore on the terminal chunk when a maxCount page is full', async () => {
    const pagedRepo = makeBigRepo(15)
    try {
      const chunks = await collectStreamLog(pagedRepo, { maxCount: 10 })
      const commits = chunks.flatMap((chunk) => chunk.commits)
      const terminal = chunks.at(-1)
      expect(commits).toHaveLength(10)
      expect(terminal?.done).toBe(true)
      expect(terminal?.hasMore).toBe(true)
    } finally {
      fs.rmSync(pagedRepo, { recursive: true, force: true })
    }
  })

  it('clears hasMore when the page exactly exhausts the history', async () => {
    const pagedRepo = makeBigRepo(10)
    try {
      const chunks = await collectStreamLog(pagedRepo, { maxCount: 10 })
      const commits = chunks.flatMap((chunk) => chunk.commits)
      const terminal = chunks.at(-1)
      expect(commits).toHaveLength(10)
      expect(terminal?.done).toBe(true)
      expect(terminal?.hasMore).toBe(false)
    } finally {
      fs.rmSync(pagedRepo, { recursive: true, force: true })
    }
  })

  it('streams a later page with skip and clears hasMore on the final page', async () => {
    const pagedRepo = makeBigRepo(15)
    try {
      const chunks = await collectStreamLog(pagedRepo, { skip: 10, maxCount: 10 })
      const commits = chunks.flatMap((chunk) => chunk.commits)
      const terminal = chunks.at(-1)
      expect(commits).toHaveLength(5)
      expect(terminal?.done).toBe(true)
      expect(terminal?.hasMore).toBe(false)
    } finally {
      fs.rmSync(pagedRepo, { recursive: true, force: true })
    }
  })

  it('cancels a superseded stream mid-flight while a concurrent stream runs to completion', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(SidecarRpcs)

        const superseded: LogChunk[] = []
        const supersededFiber = yield* Effect.fork(
          Stream.runForEach(client.streamLog({ repoPath: bigRepoPath, streamId: 1 }), (chunk) =>
            Effect.sync(() => {
              superseded.push(chunk)
            })
          )
        )

        yield* waitUntil(() => superseded.length >= 1)
        yield* Fiber.interrupt(supersededFiber)
        const supersededCount = superseded.length

        const currentChunks = yield* Stream.runCollect(
          client.streamLog({ repoPath: bigRepoPath, streamId: 2 })
        )
        const current = Chunk.toReadonlyArray(currentChunks) as LogChunk[]
        const currentCommits = current.flatMap((chunk) => chunk.commits)

        // The current stream is unaffected: every commit, in topo order, terminating cleanly.
        expect(currentCommits).toHaveLength(4000)
        expect(currentCommits[0]?.message).toBe('c4000')
        expect(currentCommits.at(-1)?.message).toBe('c1')
        const currentTerminal = current.at(-1)
        expect(currentTerminal?.done).toBe(true)
        expect(currentTerminal?.streamId).toBe(2)

        // The superseded stream stopped: it never reached its terminal chunk and delivered fewer
        // chunks than the full run — proof the interruption cut it off rather than buffering.
        expect(superseded.some((chunk) => chunk.done)).toBe(false)
        expect(supersededCount).toBeLessThan(current.length)
        expect(superseded.every((chunk) => chunk.streamId === 1)).toBe(true)
      }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
    )
  })

  it('flows an invalid repo path as a typed GitError in the stream channel', async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-stream-notrepo-'))
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(SidecarRpcs)
          return yield* Effect.either(Stream.runCollect(client.streamLog({ repoPath: notARepo })))
        }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
      )
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(GitError)
      }
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true })
    }
  })
})
