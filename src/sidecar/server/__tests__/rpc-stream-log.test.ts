import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { RepoNotOpen, SidecarRpcs } from '@shared/rpc'
import { GIT_LOG_REF_SEPARATOR, type LogChunk } from '@shared/schemas/git'
import { Chunk, Effect, Either, Fiber, Layer, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { git, makeBigRepo, makeRepo, removeRepoDir } from '../../test-support/repo-fixtures'
import { createSidecarServer } from '../http'

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

async function closeRepo(target: string): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      return yield* client.closeRepo({ repoPath: target })
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
  )
}

async function closeAndRemoveRepo(target: string): Promise<void> {
  await closeRepo(target)
  removeRepoDir(target)
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
  await openRepo(bigRepoPath)
})

afterAll(async () => {
  await closeRepo(repoPath)
  await closeRepo(bigRepoPath)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  removeRepoDir(repoPath)
  removeRepoDir(bigRepoPath)
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

  it('streams comma-containing branch and tag decorations without ambiguity', async () => {
    const decoratedRepo = makeRepo(['decorated'])
    try {
      git(decoratedRepo, ['checkout', '-b', 'release,2026'])
      git(decoratedRepo, ['tag', 'v1,stable'])
      await openRepo(decoratedRepo)

      const chunks = await collectStreamLog(decoratedRepo)
      const tip = chunks.flatMap((chunk) => chunk.commits)[0]
      const decorations = tip?.refs.split(GIT_LOG_REF_SEPARATOR)

      expect(decorations).toContain('HEAD -> release,2026')
      expect(decorations).toContain('tag: v1,stable')
    } finally {
      await closeAndRemoveRepo(decoratedRepo)
    }
  })

  it('reports hasMore on the terminal chunk when a maxCount page is full', async () => {
    const pagedRepo = makeBigRepo(15)
    try {
      await openRepo(pagedRepo)
      const chunks = await collectStreamLog(pagedRepo, { maxCount: 10 })
      const commits = chunks.flatMap((chunk) => chunk.commits)
      const terminal = chunks.at(-1)
      expect(commits).toHaveLength(10)
      expect(terminal?.done).toBe(true)
      expect(terminal?.hasMore).toBe(true)
    } finally {
      await closeAndRemoveRepo(pagedRepo)
    }
  })

  it('clears hasMore when the page exactly exhausts the history', async () => {
    const pagedRepo = makeBigRepo(10)
    try {
      await openRepo(pagedRepo)
      const chunks = await collectStreamLog(pagedRepo, { maxCount: 10 })
      const commits = chunks.flatMap((chunk) => chunk.commits)
      const terminal = chunks.at(-1)
      expect(commits).toHaveLength(10)
      expect(terminal?.done).toBe(true)
      expect(terminal?.hasMore).toBe(false)
    } finally {
      await closeAndRemoveRepo(pagedRepo)
    }
  })

  it('streams a later page with skip and clears hasMore on the final page', async () => {
    const pagedRepo = makeBigRepo(15)
    try {
      await openRepo(pagedRepo)
      const chunks = await collectStreamLog(pagedRepo, { skip: 10, maxCount: 10 })
      const commits = chunks.flatMap((chunk) => chunk.commits)
      const terminal = chunks.at(-1)
      expect(commits).toHaveLength(5)
      expect(terminal?.done).toBe(true)
      expect(terminal?.hasMore).toBe(false)
    } finally {
      await closeAndRemoveRepo(pagedRepo)
    }
  })

  it('continues a snapshot without duplicates when HEAD moves between pages', async () => {
    const pagedRepo = makeBigRepo(15)
    try {
      await openRepo(pagedRepo)
      const first = await collectStreamLog(pagedRepo, { maxCount: 10 })
      const firstCommits = first.flatMap((chunk) => chunk.commits)

      git(pagedRepo, ['commit', '--allow-empty', '-m', 'new tip'])
      const second = await collectStreamLog(pagedRepo, { skip: 10, maxCount: 10 })
      const secondCommits = second.flatMap((chunk) => chunk.commits)
      const combined = [...firstCommits, ...secondCommits]

      expect(combined).toHaveLength(15)
      expect(new Set(combined.map((commit) => commit.hash)).size).toBe(15)
      expect(combined.map((commit) => commit.message)).toEqual([
        'c15',
        'c14',
        'c13',
        'c12',
        'c11',
        'c10',
        'c9',
        'c8',
        'c7',
        'c6',
        'c5',
        'c4',
        'c3',
        'c2',
        'c1'
      ])
      expect(second.at(-1)?.hasMore).toBe(false)
    } finally {
      await closeAndRemoveRepo(pagedRepo)
    }
  })

  it('preserves one monolithic topo-order sequence across aged pages and moving refs', async () => {
    const pagedRepo = makeRepo(['base'])
    try {
      git(pagedRepo, ['checkout', '-b', 'topic'])
      git(pagedRepo, ['commit', '--allow-empty', '-m', 'topic one'])
      git(pagedRepo, ['commit', '--allow-empty', '-m', 'topic two'])
      git(pagedRepo, ['checkout', 'main'])
      git(pagedRepo, ['commit', '--allow-empty', '-m', 'main one'])
      git(pagedRepo, ['merge', '--no-ff', 'topic', '-m', 'merge topic'])
      git(pagedRepo, ['commit', '--allow-empty', '-m', 'after merge'])
      await openRepo(pagedRepo)

      const monolithicHashes = execFileSync(
        'git',
        [
          'log',
          '--ignore-missing',
          '--topo-order',
          '--format=%H',
          'HEAD',
          '--branches',
          '--remotes',
          '--tags'
        ],
        { cwd: pagedRepo, encoding: 'utf8' }
      )
        .trim()
        .split('\n')
      const first = await collectStreamLog(pagedRepo, { maxCount: 2 })

      vi.useFakeTimers()
      vi.advanceTimersByTime(5 * 60_000)
      vi.useRealTimers()
      git(pagedRepo, ['commit', '--allow-empty', '-m', 'new ref tip'])

      const second = await collectStreamLog(pagedRepo, { skip: 2, maxCount: 2 })
      const third = await collectStreamLog(pagedRepo, { skip: 4, maxCount: 2 })
      const fourth = await collectStreamLog(pagedRepo, { skip: 6, maxCount: 2 })
      const pagedCommits = [...first, ...second, ...third, ...fourth].flatMap(
        (chunk) => chunk.commits
      )
      const pagedHashes = pagedCommits.map((commit) => commit.hash)

      expect(pagedHashes).toEqual(monolithicHashes)
      expect(fourth.at(-1)?.hasMore).toBe(false)
    } finally {
      vi.useRealTimers()
      await closeAndRemoveRepo(pagedRepo)
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

        expect(currentCommits).toHaveLength(4000)
        expect(currentCommits[0]?.message).toBe('c4000')
        expect(currentCommits.at(-1)?.message).toBe('c1')
        const currentTerminal = current.at(-1)
        expect(currentTerminal?.done).toBe(true)
        expect(currentTerminal?.streamId).toBe(2)

        expect(superseded.some((chunk) => chunk.done)).toBe(false)
        expect(supersededCount).toBeLessThan(current.length)
        expect(superseded.every((chunk) => chunk.streamId === 1)).toBe(true)
      }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
    )
  })

  it('flows an unopened directory as a typed RepoNotOpen in the stream channel', async () => {
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
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      removeRepoDir(notARepo)
    }
  })

  it('rejects a valid repository that has no open sidecar session', async () => {
    const unopenedRepo = makeRepo(['only'])
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(SidecarRpcs)
          return yield* Effect.either(
            Stream.runCollect(client.streamLog({ repoPath: unopenedRepo }))
          )
        }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
      )
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      removeRepoDir(unopenedRepo)
    }
  })

  it('streams a commit reachable only from a tag', async () => {
    const taggedRepo = makeRepo(['base'])
    try {
      git(taggedRepo, ['checkout', '--detach', 'main'])
      git(taggedRepo, ['commit', '--allow-empty', '-m', 'tagged only'])
      const taggedSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: taggedRepo,
        encoding: 'utf8'
      }).trim()
      git(taggedRepo, ['tag', 'only-tag'])
      git(taggedRepo, ['checkout', 'main'])
      await openRepo(taggedRepo)

      const chunks = await collectStreamLog(taggedRepo)

      expect(chunks.flatMap((chunk) => chunk.commits).map((commit) => commit.hash)).toContain(
        taggedSha
      )
    } finally {
      await closeAndRemoveRepo(taggedRepo)
    }
  })
})
