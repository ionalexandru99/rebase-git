import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { LogChunk } from '@shared/schemas/git'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { callRpcByTag, runStreamLog } from '../../main/sidecar-rpc'
import { createSidecarServer } from '../server'
import { makeBigRepo, makeRepo } from './repo-fixtures'

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
  await callRpcByTag('openRepo', baseUrl, TOKEN, { repoPath })
  await callRpcByTag('openRepo', baseUrl, TOKEN, { repoPath: bigRepoPath })
})

afterAll(async () => {
  await callRpcByTag('closeRepo', baseUrl, TOKEN, { repoPath })
  await callRpcByTag('closeRepo', baseUrl, TOKEN, { repoPath: bigRepoPath })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(repoPath, { recursive: true, force: true })
  fs.rmSync(bigRepoPath, { recursive: true, force: true })
})

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
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-fake-git-'))
    const statePath = path.join(fakeBin, 'state')
    const gitPath = path.join(fakeBin, 'git')
    const originalPath = process.env.PATH
    fs.writeFileSync(
      gitPath,
      `#!/bin/sh\nprintf '%s' "$$" > "$FAKE_GIT_STATE"\ntrap 'printf exited > "$FAKE_GIT_STATE"; exit 0' TERM INT\nwhile true; do /bin/sleep 0.05; done\n`
    )
    fs.chmodSync(gitPath, 0o755)
    process.env.PATH = `${fakeBin}:${originalPath ?? ''}`
    process.env.FAKE_GIT_STATE = statePath
    const controller = new AbortController()

    try {
      const stream = runStreamLog(baseUrl, TOKEN, { repoPath }, controller.signal, () => {})
      await waitUntil(() => fs.existsSync(statePath))
      controller.abort()
      await stream
      await waitUntil(() => fs.readFileSync(statePath, 'utf8') === 'exited')
      expect(fs.readFileSync(statePath, 'utf8')).toBe('exited')
    } finally {
      process.env.PATH = originalPath
      delete process.env.FAKE_GIT_STATE
      if (fs.existsSync(statePath)) {
        const state = fs.readFileSync(statePath, 'utf8')
        if (/^\d+$/.test(state)) {
          process.kill(Number(state), 'SIGTERM')
        }
      }
      fs.rmSync(fakeBin, { recursive: true, force: true })
    }
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

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition timed out')
}
