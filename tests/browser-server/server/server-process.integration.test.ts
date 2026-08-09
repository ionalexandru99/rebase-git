import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const children: ChildProcess[] = []
const repositoryRoot = process.cwd()

beforeAll(() => {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  for (const script of ['build:web', 'build:server']) {
    const result = spawnSync(command, [script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: process.platform === 'win32'
    })
    if (result.status !== 0) {
      throw new Error(`${script} failed\n${result.stdout}\n${result.stderr}`)
    }
  }
})

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve()
            return
          }
          child.once('exit', () => resolve())
          child.kill('SIGKILL')
        })
    )
  )
})

function spawnServer(
  arguments_: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv }
): ChildProcess {
  const child = spawn(
    process.execPath,
    [path.join(repositoryRoot, 'out/server/index.js'), ...arguments_],
    {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  children.push(child)
  return child
}

function waitForOutput(child: ChildProcess, pattern: RegExp): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}: ${output}`)), 5_000)
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString()
      if (pattern.test(output)) {
        clearTimeout(timeout)
        child.stdout?.off('data', onData)
        resolve(output)
      }
    }
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`Server exited before readiness: code=${code} signal=${signal}\n${output}`))
    })
    child.stdout?.on('data', onData)
  })
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

describe('standalone Server process', () => {
  it('uses the invocation directory, stays alive without a browser, and stops cleanly on Ctrl+C', async () => {
    const invocationDirectory = await mkdtemp(path.join(tmpdir(), 'rebase-server-cwd-'))
    const child = spawnServer(['--open', 'none', '--read-only'], {
      cwd: invocationDirectory
    })

    const output = await waitForOutput(child, /Press Ctrl\+C to stop/)
    const browserUrl = output.match(
      /Open (http:\/\/rebase-[a-f0-9]+\.localhost:\d+\/auth\/[A-Za-z0-9_-]+)/
    )?.[1]

    expect(output).toContain('Rebase Server is ready')
    expect(output).toContain(`Local Environment: ${invocationDirectory} (read-only)`)
    expect(browserUrl).toBeDefined()
    expect(child.exitCode).toBeNull()

    const authentication = await fetch(browserUrl!, { redirect: 'manual' })
    expect(authentication.status).toBe(303)
    const cookie = authentication.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toBeDefined()
    const origin = new URL(browserUrl!).origin
    const htmlResponse = await fetch(`${origin}/`, { headers: { Cookie: cookie! } })
    const html = await htmlResponse.text()
    const serverInstanceId = html.match(
      /name="rebase-server-instance-id" content="([^"]+)"/
    )?.[1]
    const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    expect(serverInstanceId).toBeDefined()
    expect(assetPath).toBeDefined()
    const manifestResponse = await fetch(`${origin}/rebase-manifest.json`, {
      headers: { Cookie: cookie! }
    })
    const manifest = (await manifestResponse.json()) as { rendererBuildId: string }
    const assetResponse = await fetch(`${origin}${assetPath}`, { headers: { Cookie: cookie! } })
    const asset = await assetResponse.text()
    const bootstrap = await fetch(`${origin}/api/bootstrap`, {
      headers: {
        Cookie: cookie!,
        'X-Rebase-Renderer-Build-Id': manifest.rendererBuildId,
        'X-Rebase-Server-Instance-Id': serverInstanceId!
      }
    })

    expect(htmlResponse.headers.get('cache-control')).toBe('no-store')
    expect(manifestResponse.headers.get('cache-control')).toBe('no-store')
    expect(assetResponse.headers.get('cache-control')).toContain('immutable')
    expect(asset).toContain(manifest.rendererBuildId)
    await expect(bootstrap.json()).resolves.toMatchObject({
      environment: { path: invocationDirectory },
      readOnly: true
    })
    expect(child.exitCode).toBeNull()

    const exited = waitForExit(child)
    child.kill('SIGINT')
    await expect(exited).resolves.toEqual({ code: 0, signal: null })
  })

  it('keeps running and prints the usable URL when native browser opening fails', async () => {
    const invocationDirectory = await mkdtemp(path.join(tmpdir(), 'rebase-server-open-'))
    const child = spawnServer([], {
      cwd: invocationDirectory,
      env: { ...process.env, DISPLAY: ':0', PATH: '' }
    })

    const output = await waitForOutput(child, /Press Ctrl\+C to stop/)

    expect(output).toMatch(/Open http:\/\/rebase-[a-f0-9]+\.localhost:\d+\/auth\//)
    expect(child.exitCode).toBeNull()

    const exited = waitForExit(child)
    child.kill('SIGINT')
    await expect(exited).resolves.toEqual({ code: 0, signal: null })
  })

  it('bounds and redacts structured startup failures', async () => {
    const secret = 'browser-start-secret'
    const child = spawnServer([`--/auth/${secret}${'x'.repeat(8_000)}`], {
      cwd: repositoryRoot
    })
    let diagnostics = ''
    child.stderr?.on('data', (chunk) => {
      diagnostics += chunk.toString()
    })

    const exit = await waitForExit(child)
    const lines = diagnostics.trim().split('\n')

    expect(exit).toEqual({ code: 1, signal: null })
    expect(lines).toHaveLength(1)
    expect(Buffer.byteLength(lines[0])).toBeLessThanOrEqual(4_095)
    expect(() => JSON.parse(lines[0])).not.toThrow()
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'server-start-failed' })
    expect(lines[0]).not.toContain(secret)
  })
})
