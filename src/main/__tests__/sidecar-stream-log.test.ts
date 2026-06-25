import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { LogChunk } from '@shared/schemas/git'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeBigRepo, makeRepo } from '../../sidecar/__tests__/repo-fixtures'
import { createSidecarServer } from '../../sidecar/server'
import { runStreamLog } from '../sidecar-rpc'

const TOKEN = 'main-stream-test-token'
let baseUrl: string
let repoPath: string
let bigRepoPath: string
let server: ReturnType<typeof createSidecarServer>

beforeAll(async () => {
  repoPath = makeRepo(['init', 'second', 'third'])
  bigRepoPath = makeBigRepo(4000)
  server = createSidecarServer(TOKEN)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(repoPath, { recursive: true, force: true })
  fs.rmSync(bigRepoPath, { recursive: true, force: true })
})

describe('runStreamLog (main → sidecar streaming RPC adapter)', () => {
  it('delivers the full log in topo order to the chunk callback, ending with a done chunk', async () => {
    const chunks: LogChunk[] = []
    await runStreamLog(baseUrl, TOKEN, { repoPath }, new AbortController().signal, (chunk) => {
      chunks.push(chunk)
    })
    const commits = chunks.flatMap((chunk) => chunk.commits)
    expect(commits.map((commit) => commit.message)).toEqual(['third', 'second', 'init'])
    expect(chunks.at(-1)?.done).toBe(true)
  })

  it('stamps each chunk with the requested streamId', async () => {
    const chunks: LogChunk[] = []
    await runStreamLog(
      baseUrl,
      TOKEN,
      { repoPath, streamId: 7 },
      new AbortController().signal,
      (chunk) => {
        chunks.push(chunk)
      }
    )
    expect(chunks.every((chunk) => chunk.streamId === 7)).toBe(true)
  })

  it('stops quietly when the signal aborts mid-stream, then a later stream completes', async () => {
    const controller = new AbortController()
    const aborted: LogChunk[] = []
    await expect(
      runStreamLog(baseUrl, TOKEN, { repoPath: bigRepoPath }, controller.signal, (chunk) => {
        aborted.push(chunk)
        if (aborted.length === 1) {
          controller.abort()
        }
      })
    ).resolves.toBeUndefined()
    expect(aborted.some((chunk) => chunk.done)).toBe(false)

    const full: LogChunk[] = []
    await runStreamLog(
      baseUrl,
      TOKEN,
      { repoPath: bigRepoPath },
      new AbortController().signal,
      (chunk) => {
        full.push(chunk)
      }
    )
    expect(full.flatMap((chunk) => chunk.commits)).toHaveLength(4000)
    expect(full.at(-1)?.done).toBe(true)
  })

  it('rejects with an Error when the repo path is not a repository', async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-main-stream-notrepo-'))
    try {
      await expect(
        runStreamLog(baseUrl, TOKEN, { repoPath: notARepo }, new AbortController().signal, () => {})
      ).rejects.toThrow()
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true })
    }
  })
})
