import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net, { type AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { GitError, SidecarRpcs } from '@shared/rpc'
import type { CloneProgress } from '@shared/schemas/git'
import { Chunk, Effect, Either, Layer, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSidecarServer } from '../http'

const TOKEN = 'rpc-clone-test-token'
let baseUrl: string
let server: ReturnType<typeof createSidecarServer>
let homeRoot: string
let sourceRepo: string
let destination: string
// Accepts the connection and answers nothing, so a clone stays in the handshake until it is torn
// down. The error handler matters on Windows, where killing git resets the socket.
let stalledServer: net.Server
let stalledPort: number

const protocolLayer = () =>
  RpcClient.layerProtocolHttp({
    url: `${baseUrl}/rpc`,
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setHeader(request, 'authorization', `Bearer ${TOKEN}`)
      )
  }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerNdjson))

const fileUrl = (repoPath: string): string => `file://${repoPath.split(path.sep).join('/')}`

function clone(payload: {
  url: string
  parentDir: string
  folderName: string
}): Promise<Either.Either<CloneProgress[], unknown>> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SidecarRpcs)
      const chunks = yield* Effect.either(Stream.runCollect(client.cloneRepo(payload)))
      return Either.map(chunks, (collected) => Chunk.toReadonlyArray(collected) as CloneProgress[])
    }).pipe(Effect.scoped, Effect.provide(protocolLayer()))
  )
}

beforeAll(async () => {
  homeRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.homedir(), '.rebase-rpc-clone-')))
  sourceRepo = path.join(homeRoot, 'source')
  destination = path.join(homeRoot, 'destination')
  fs.mkdirSync(sourceRepo)
  fs.mkdirSync(destination)
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', sourceRepo, ...args], { stdio: 'ignore' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('commit', '--allow-empty', '-m', 'initial')

  stalledServer = net.createServer((socket) => {
    socket.on('data', () => {})
    socket.on('error', () => {})
  })
  stalledServer.on('error', () => {})
  await new Promise<void>((resolve) => stalledServer.listen(0, '127.0.0.1', resolve))
  stalledPort = (stalledServer.address() as AddressInfo).port

  server = createSidecarServer(TOKEN)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise<void>((resolve) => stalledServer.close(() => resolve()))
  fs.rmSync(homeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('cloneRepo RPC over the /rpc transport', () => {
  it('streams progress and ends with the cloned repository path', async () => {
    const result = await clone({
      url: `file://${sourceRepo.split(path.sep).join('/')}`,
      parentDir: destination,
      folderName: 'cloned'
    })

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right[0].phase).toBe('Connecting')
      expect(result.right.at(-1)).toMatchObject({
        done: true,
        path: path.join(destination, 'cloned')
      })
    }
    expect(fs.existsSync(path.join(destination, 'cloned', '.git'))).toBe(true)
  })

  it('surfaces a typed GitError on the error channel for an unusable URL', async () => {
    const result = await clone({
      url: 'not-a-url',
      parentDir: destination,
      folderName: 'nope'
    })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('that does not look like a repository URL')
    }
  })
})

// The renderer cancels, and main aborts the request signal — everything past that point happens over
// the wire. This is the seam between the in-process interrupt test and the E2E reload test: it proves
// the abort reaches the server fiber, so git dies and the destination is handed back.
describe('cancelling a cloneRepo stream over the transport', () => {
  it('tears the clone down server-side and frees the destination', async () => {
    const controller = new AbortController()
    const payload = {
      url: `git://127.0.0.1:${stalledPort}/stalled.git`,
      parentDir: destination,
      folderName: 'cancelled'
    }

    const cancelled = Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(SidecarRpcs)
        yield* Stream.runForEach(client.cloneRepo(payload), () =>
          // The first chunk means the request is live server-side; cancel from there.
          Effect.sync(() => controller.abort())
        )
      }).pipe(Effect.scoped, Effect.provide(protocolLayer())),
      { signal: controller.signal }
    )
    await cancelled

    // Freeing the claim is the observable proof that the server-side scope closed: it is released by
    // the same teardown that kills git and sweeps its staging directory.
    await expect
      .poll(
        async () => {
          const retry = await clone({ ...payload, url: fileUrl(sourceRepo) })
          if (Either.isRight(retry)) {
            return 'cloned'
          }
          fs.rmSync(path.join(destination, 'cancelled'), { recursive: true, force: true })
          return (retry.left as GitError).message
        },
        { timeout: 15_000, interval: 500 }
      )
      .toBe('cloned')
    expect(fs.existsSync(path.join(destination, 'cancelled', '.git'))).toBe(true)
  })
})
