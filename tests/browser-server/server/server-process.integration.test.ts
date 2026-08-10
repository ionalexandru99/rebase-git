import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { browserServerFetch } from './browser-server-harness'

const children: ChildProcess[] = []
const repositoryRoot = process.cwd()

beforeAll(() => {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  for (const script of ['build:web', 'build:server']) {
    const result = spawnSync(command, [script], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32'
    })
    if (result.status !== 0) {
      throw new Error(`${script} failed\n${result.stdout}\n${result.stderr}`)
    }
  }
}, 300_000)

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
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout?.off('data', onData)
      child.off('exit', onExit)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(new Error(`Server exited before readiness: code=${code} signal=${signal}\n${output}`))
    }
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString()
      if (pattern.test(output)) {
        cleanup()
        resolve(output)
      }
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${pattern}: ${output}`))
    }, 5_000)
    child.once('exit', onExit)
    child.stdout?.on('data', onData)
  })
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      resolve({ code, signal })
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for the Server process to stop'))
    }, 10_000)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function expectProcessSignalHandled(exit: {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}): void {
  if (process.platform === 'win32') {
    expect(exit).toEqual({ code: null, signal: 'SIGINT' })
    return
  }
  expect(exit).toEqual({ code: 0, signal: null })
}

describe('standalone Server process', () => {
  it('uses the invocation directory, stays alive without a browser, and stops cleanly on Ctrl+C', async () => {
    const invocationDirectory = await mkdtemp(path.join(tmpdir(), 'rebase-server-cwd-'))
    const expectedInvocationDirectory = await realpath(invocationDirectory)
    const child = spawnServer(['--open', 'none', '--read-only'], {
      cwd: invocationDirectory
    })

    const output = await waitForOutput(child, /Press Ctrl\+C to stop/)
    const browserUrl = output.match(
      /Open (http:\/\/rebase-[a-f0-9]+\.localhost:\d+\/auth\/[A-Za-z0-9_-]+)/
    )?.[1]

    expect(output).toContain('Rebase Server is ready')
    expect(browserUrl).toBeDefined()
    expect(child.exitCode).toBeNull()
    const advertisedUrl = new URL(browserUrl!)
    const serverAddress = {
      authority: advertisedUrl.host,
      origin: advertisedUrl.origin,
      port: Number.parseInt(advertisedUrl.port, 10)
    }

    const authentication = await browserServerFetch(serverAddress, browserUrl!, {
      redirect: 'manual'
    })
    expect(authentication.status).toBe(303)
    const cookie = authentication.headers.getSetCookie()[0]?.split(';', 1)[0]
    expect(cookie).toBeDefined()
    const origin = new URL(browserUrl!).origin
    const htmlResponse = await browserServerFetch(serverAddress, `${origin}/`, {
      headers: { Cookie: cookie! }
    })
    const html = await htmlResponse.text()
    const serverInstanceId = html.match(
      /name="rebase-server-instance-id" content="([^"]+)"/
    )?.[1]
    const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    expect(serverInstanceId).toBeDefined()
    expect(assetPath).toBeDefined()
    const manifestResponse = await browserServerFetch(
      serverAddress,
      `${origin}/rebase-manifest.json`,
      {
        headers: { Cookie: cookie! }
      }
    )
    const manifest = (await manifestResponse.json()) as { rendererBuildId: string }
    const assetResponse = await browserServerFetch(serverAddress, `${origin}${assetPath}`, {
      headers: { Cookie: cookie! }
    })
    const asset = await assetResponse.text()
    const bootstrap = await browserServerFetch(serverAddress, `${origin}/api/bootstrap`, {
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
    const bootstrapState = (await bootstrap.json()) as {
      readonly environment: { readonly path: string }
      readonly readOnly: boolean
    }
    expect(bootstrapState).toMatchObject({
      readOnly: true
    })
    expect(await realpath(bootstrapState.environment.path)).toBe(expectedInvocationDirectory)
    expect(output).toContain(`Local Environment: ${bootstrapState.environment.path} (read-only)`)
    expect(child.exitCode).toBeNull()

    const exited = waitForExit(child)
    child.kill('SIGINT')
    expectProcessSignalHandled(await exited)
  }, 30_000)

  it('keeps running and prints the usable URL when native browser opening fails', async () => {
    const invocationDirectory = await mkdtemp(path.join(tmpdir(), 'rebase-server-open-'))
    const child = spawnServer([], {
      cwd: invocationDirectory,
      env: { ...process.env, DISPLAY: ':0', PATH: '' }
    })

    const output = await waitForOutput(child, /Press Ctrl\+C to stop/)
    const browserUrl = output.match(
      /Open (http:\/\/rebase-[a-f0-9]+\.localhost:\d+\/auth\/[A-Za-z0-9_-]+)/
    )?.[1]

    expect(browserUrl).toBeDefined()
    expect(child.exitCode).toBeNull()
    const advertisedUrl = new URL(browserUrl!)
    const health = await browserServerFetch(
      {
        authority: advertisedUrl.host,
        origin: advertisedUrl.origin,
        port: Number.parseInt(advertisedUrl.port, 10)
      },
      '/.well-known/rebase/health',
      { method: 'HEAD' }
    )
    expect(health.status).toBe(204)

    const exited = waitForExit(child)
    child.kill('SIGINT')
    expectProcessSignalHandled(await exited)
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
