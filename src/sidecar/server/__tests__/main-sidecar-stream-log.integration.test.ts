import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { LogChunk } from '@shared/schemas/git'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { callRpcByTag, runStreamLog } from '../../../main/sidecar/rpc'
import type { RunningGitProcess, SpawnGitOptions } from '../../git/spawn'
import { processAlive, waitUntil } from '../../test-support/hanging-git'
import { makeBigRepo, makeRepo } from '../../test-support/repo-fixtures'
import { createSidecarServer } from '../http'

const startedGitProcesses: RunningGitProcess[] = []

// The sidecar keeps the log process behind the RPC boundary, so recording what production spawned
// is the only way to name the pid that has to be dead once the transport aborts.
vi.mock('../../git/spawn', async (importOriginal) => {
  const spawn = await importOriginal<typeof import('../../git/spawn')>()
  return {
    ...spawn,
    startGit: (args: string[], options?: SpawnGitOptions) => {
      const running = spawn.startGit(args, options)
      startedGitProcesses.push(running)
      return running
    }
  }
})

const TOKEN = 'main-stream-test-token'
let baseUrl: string
let repoPath: string
let bigRepoPath: string
let abortRepoPath: string
let server: ReturnType<typeof createSidecarServer>

beforeAll(async () => {
  repoPath = makeRepo(['init', 'second', 'third'])
  bigRepoPath = makeBigRepo(4000)
  // Cancellation needs a history long enough that git is still walking it when the abort lands:
  // git logs 4000 commits faster than the first chunk reaches the main side.
  abortRepoPath = makeBigRepo(50_000)
  server = createSidecarServer(TOKEN)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
  await callRpcByTag('openRepo', baseUrl, TOKEN, { repoPath })
  await callRpcByTag('openRepo', baseUrl, TOKEN, { repoPath: bigRepoPath })
  await callRpcByTag('openRepo', baseUrl, TOKEN, { repoPath: abortRepoPath })
}, 120_000)

afterAll(async () => {
  await callRpcByTag('closeRepo', baseUrl, TOKEN, { repoPath })
  await callRpcByTag('closeRepo', baseUrl, TOKEN, { repoPath: bigRepoPath })
  await callRpcByTag('closeRepo', baseUrl, TOKEN, { repoPath: abortRepoPath })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(repoPath, { recursive: true, force: true })
  fs.rmSync(bigRepoPath, { recursive: true, force: true })
  fs.rmSync(abortRepoPath, { recursive: true, force: true })
}, 60_000)

describe('main → sidecar RPC adapter', () => {
  it('resolves concurrent repository data requests', async () => {
    const [status, branches, refs] = await Promise.all([
      callRpcByTag('getStatus', baseUrl, TOKEN, { repoPath }, { timeoutMs: 1000 }),
      callRpcByTag('getLocalBranches', baseUrl, TOKEN, { repoPath }, { timeoutMs: 1000 }),
      callRpcByTag('getRemoteRefs', baseUrl, TOKEN, { repoPath }, { timeoutMs: 1000 })
    ])

    expect(status._tag).toBe('Ok')
    expect(branches._tag).toBe('Ok')
    expect(refs._tag).toBe('Ok')
  })
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

  it('kills the sidecar git child when the main transport is aborted', async () => {
    const alreadyStarted = startedGitProcesses.length
    const controller = new AbortController()
    const chunks: LogChunk[] = []

    await expect(
      runStreamLog(baseUrl, TOKEN, { repoPath: abortRepoPath }, controller.signal, (chunk) => {
        chunks.push(chunk)
        if (chunks.length === 1) {
          controller.abort()
        }
      })
    ).resolves.toBeUndefined()

    const streamed = startedGitProcesses.slice(alreadyStarted)
    expect(streamed).toHaveLength(1)
    const gitPid = streamed[0].child.pid
    expect(gitPid).toBeGreaterThan(0)
    await waitUntil(() => !processAlive(gitPid), 10_000, 'sidecar git log process exit')

    expect(processAlive(gitPid)).toBe(false)
    // A zero exit would mean git walked the whole history instead of being torn down mid-stream.
    const { code } = await streamed[0].result
    expect(code).not.toBe(0)
    expect(chunks.some((chunk) => chunk.done)).toBe(false)
  }, 30_000)

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
