import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STREAM_BATCH_SIZE } from '../log-stream'
import { createSidecarServer } from '../server'

const TOKEN = 'test-token'
let baseUrl: string
let repoPath: string
let server: ReturnType<typeof createSidecarServer>

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createFixtureRepo(commitCount: number): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-sidecar-log-'))
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  for (let i = 1; i <= commitCount; i++) {
    fs.writeFileSync(path.join(repo, 'file.txt'), `${i}\n`)
    git(repo, ['add', 'file.txt'])
    git(repo, ['commit', '-m', `commit ${i}`])
  }
  return repo
}

async function call(op: string, body: Record<string, unknown>, token = TOKEN): Promise<Response> {
  return fetch(`${baseUrl}/op/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
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

  it('rejects op requests without a valid token', async () => {
    const response = await call('get-status', { repoPath }, 'wrong')
    expect(response.status).toBe(401)
  })

  it('opens a repo and reports the default branch', async () => {
    const response = await call('open-repo', { repoPath })
    const body = await response.json()
    expect(body._tag).toBe('Ok')
    expect(body.result.path).toContain(path.basename(repoPath))
  })

  it('returns RepoNotOpen for status before open', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-unopened-'))
    const response = await call('get-status', { repoPath: other })
    const body = await response.json()
    expect(body._tag).toBe('RepoNotOpen')
    fs.rmSync(other, { recursive: true, force: true })
  })

  it('reports status after a file change', async () => {
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'content\n')
    const response = await call('get-status', { repoPath })
    const body = await response.json()
    expect(body._tag).toBe('Ok')
    expect(body.status.not_added).toContain('new.txt')
  })

  it('stages, commits, and reflects in the log', async () => {
    const staged = await (await call('stage-file', { repoPath, file: 'new.txt' })).json()
    expect(staged._tag).toBe('Ok')

    const committed = await (await call('commit', { repoPath, message: 'add new.txt' })).json()
    expect(committed._tag).toBe('Ok')
    expect(committed.result.commit).toBeTruthy()

    const log = await (await call('get-log', { repoPath })).json()
    expect(log._tag).toBe('Ok')
    expect(log.log.all[0].message).toBe('add new.txt')
  })

  it('lists branches', async () => {
    const body = await (await call('get-branches', { repoPath })).json()
    expect(body._tag).toBe('Ok')
    expect(body.branches.current).toBe('main')
    expect(body.branches.all).toContain('main')
  })

  it('lists local branches separately', async () => {
    const body = await (await call('get-local-branches', { repoPath })).json()
    expect(body._tag).toBe('Ok')
    expect(body.branches.current).toBe('main')
    expect(body.branches.all).toContain('main')
  })

  it('lists remote refs separately', async () => {
    const body = await (await call('get-remote-refs', { repoPath })).json()
    expect(body._tag).toBe('Ok')
    expect(body.refs.remotes).toEqual([])
    expect(body.refs.tags).toEqual([])
  })

  it('rejects an unknown op', async () => {
    const response = await call('nope', { repoPath })
    expect(response.status).toBe(404)
  })

  it('streams log chunks over the sidecar stream endpoint', async () => {
    const response = await fetch(`${baseUrl}/stream/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ repoPath })
    })
    expect(response.ok).toBe(true)
    const lines = (await response.text()).trim().split('\n')
    const chunks = lines.map((line) => JSON.parse(line) as { commits: Array<{ message: string }> })
    expect(
      chunks.some((chunk) => chunk.commits.some((commit) => commit.message === 'initial'))
    ).toBe(true)
  })

  it('streams more than one batch of commits', async () => {
    const largeRepo = createFixtureRepo(STREAM_BATCH_SIZE + 5)
    try {
      await call('open-repo', { repoPath: largeRepo })
      const response = await fetch(`${baseUrl}/stream/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ repoPath: largeRepo })
      })
      expect(response.ok).toBe(true)
      const lines = (await response.text()).trim().split('\n')
      const chunks = lines.map(
        (line) => JSON.parse(line) as { commits: Array<{ message: string }>; done: boolean }
      )
      const commits = chunks.flatMap((chunk) => chunk.commits)

      expect(commits).toHaveLength(STREAM_BATCH_SIZE + 5)
      expect(chunks.filter((chunk) => chunk.commits.length > 0)).toHaveLength(2)
      expect(chunks[chunks.length - 1]?.done).toBe(true)
    } finally {
      fs.rmSync(largeRepo, { recursive: true, force: true })
    }
  })

  it('reports hasMore when a maxCount page is full', async () => {
    const pagedRepo = createFixtureRepo(15)
    try {
      await call('open-repo', { repoPath: pagedRepo })
      const response = await fetch(`${baseUrl}/stream/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ repoPath: pagedRepo, maxCount: 10 })
      })
      expect(response.ok).toBe(true)
      const lines = (await response.text()).trim().split('\n')
      const chunks = lines.map(
        (line) =>
          JSON.parse(line) as {
            commits: Array<{ message: string }>
            done: boolean
            hasMore?: boolean
          }
      )
      const commits = chunks.flatMap((chunk) => chunk.commits)
      const terminal = chunks[chunks.length - 1]

      expect(commits).toHaveLength(10)
      expect(terminal?.done).toBe(true)
      expect(terminal?.hasMore).toBe(true)
    } finally {
      fs.rmSync(pagedRepo, { recursive: true, force: true })
    }
  })

  it('streams a later page with skip and clears hasMore on the final page', async () => {
    const pagedRepo = createFixtureRepo(15)
    try {
      await call('open-repo', { repoPath: pagedRepo })
      const response = await fetch(`${baseUrl}/stream/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ repoPath: pagedRepo, skip: 10, maxCount: 10 })
      })
      expect(response.ok).toBe(true)
      const lines = (await response.text()).trim().split('\n')
      const chunks = lines.map(
        (line) =>
          JSON.parse(line) as {
            commits: Array<{ message: string }>
            done: boolean
            hasMore?: boolean
          }
      )
      const commits = chunks.flatMap((chunk) => chunk.commits)
      const terminal = chunks[chunks.length - 1]

      expect(commits).toHaveLength(5)
      expect(terminal?.done).toBe(true)
      expect(terminal?.hasMore).toBe(false)
    } finally {
      fs.rmSync(pagedRepo, { recursive: true, force: true })
    }
  })

  it('rejects checkout requests with an invalid ref kind', async () => {
    const response = await call('checkout-ref', { repoPath, refKind: 'branch', fullPath: 'main' })
    expect(response.status).toBe(400)
  })

  it('returns 400 when required string fields are missing', async () => {
    const status = await call('get-status', {})
    expect(status.status).toBe(400)
    expect(await status.json()).toEqual({ error: 'bad request' })

    const scan = await call('scan-for-repos', {})
    expect(scan.status).toBe(400)
    expect(await scan.json()).toEqual({ error: 'bad request' })
  })

  it('returns 413 when the request body exceeds the size limit', async () => {
    const response = await fetch(`${baseUrl}/op/get-status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: `{"repoPath":${JSON.stringify('x'.repeat(1024 * 1024 + 1))}}`
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload too large' })
  })

  it('rejects scan-for-repos paths with parent traversal', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-scan-server-'))
    try {
      const traversal = `${parent}/../..${path.sep}etc`
      const response = await call('scan-for-repos', { dirPath: traversal })
      const body = await response.json()
      expect(body._tag).toBe('GitError')
      expect(body.message).toBe('invalid directory path')
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('returns a generic error body without leaking exception details', async () => {
    const response = await fetch(`${baseUrl}/op/get-status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: '{not json'
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal error' })
  })

  it('rejects browser CORS preflight requests', async () => {
    const response = await fetch(`${baseUrl}/op/get-branches`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, b3, traceparent',
        'access-control-request-private-network': 'true'
      }
    })
    expect(response.status).toBe(403)
  })

  it('does not include wildcard CORS headers on op responses', async () => {
    const response = await call('get-branches', { repoPath })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
