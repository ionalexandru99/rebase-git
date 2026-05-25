import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSidecarServer } from '../server'

const TOKEN = 'test-token'
let baseUrl: string
let repoPath: string
let server: ReturnType<typeof createSidecarServer>

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
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
  it('serves health without auth', async () => {
    const response = await fetch(`${baseUrl}/health`)
    expect(response.ok).toBe(true)
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

  it('rejects an unknown op', async () => {
    const response = await call('nope', { repoPath })
    expect(response.status).toBe(404)
  })

  it('rejects scan-for-repos paths with parent traversal', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-scan-server-'))
    try {
      const traversal = path.join(parent, '..', path.basename(parent), '..', 'etc')
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

  it('answers CORS preflight without auth and advertises the request headers', async () => {
    const response = await fetch(`${baseUrl}/op/get-branches`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, b3, traceparent',
        'access-control-request-private-network': 'true'
      }
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    const allowHeaders = response.headers.get('access-control-allow-headers') ?? ''
    expect(allowHeaders).toContain('authorization')
    expect(allowHeaders).toContain('traceparent')
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('includes the allow-origin header on op responses so the renderer can read them', async () => {
    const response = await call('get-branches', { repoPath })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })
})
