import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { Effect } from 'effect4'
import {
  type BrowserCommand,
  BrowserCommandFailure,
  type BrowserCommandRunner,
  openBrowser,
  runBrowserCommand
} from '../../../src/server/features/server-invocation'

const browserUrl = 'http://localhost:4312/auth/one-time-nonce'
const readinessUrl = 'http://localhost:4312/health'
const localPowerShellExecutable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const canExecutePowerShell =
  spawnSync(
    localPowerShellExecutable,
    ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'],
    { stdio: 'ignore' }
  ).status === 0

function recordingRunner(commands: BrowserCommand[]): BrowserCommandRunner {
  return (command) =>
    Effect.sync(() => {
      commands.push(command)
    })
}

describe('platform browser opener', () => {
  it('reports a launcher that starts and then exits unsuccessfully', async () => {
    const exit = await Effect.runPromiseExit(
      runBrowserCommand({
        executable: process.execPath,
        arguments: ['-e', 'process.exit(7)']
      })
    )

    expect(exit._tag).toBe('Failure')
  })

  it('opens the default Windows browser without interpolating the URL into shell code', async () => {
    const commands: BrowserCommand[] = []

    const result = await Effect.runPromise(
      openBrowser(
        { browserUrl, readinessUrl },
        {
          environment: { platform: 'win32', release: '10.0.26100', variables: {} },
          commandRunner: recordingRunner(commands)
        }
      )
    )

    expect(result).toEqual({ _tag: 'Opened' })
    expect(commands).toEqual([
      {
        executable: 'powershell.exe',
        arguments: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '& { param([string]$BrowserUrl) Start-Process -FilePath $BrowserUrl }',
          browserUrl
        ]
      }
    ])
  })

  it.each([
    ['darwin' as const, {}, 'open'],
    ['linux' as const, { DISPLAY: ':0' }, 'xdg-open'],
    ['linux' as const, { WAYLAND_DISPLAY: 'wayland-0' }, 'xdg-open']
  ])('uses the native graphical opener on %s', async (platform, variables, executable) => {
    const commands: BrowserCommand[] = []

    const result = await Effect.runPromise(
      openBrowser(
        { browserUrl, readinessUrl },
        {
          environment: { platform, release: 'native', variables },
          commandRunner: recordingRunner(commands)
        }
      )
    )

    expect(result).toEqual({ _tag: 'Opened' })
    expect(commands).toEqual([
      { executable, arguments: [browserUrl] }
    ])
  })

  it('verifies Windows localhost forwarding before opening from WSL', async () => {
    const commands: BrowserCommand[] = []

    const result = await Effect.runPromise(
      openBrowser(
        { browserUrl, readinessUrl },
        {
          environment: {
            platform: 'linux',
            release: '6.6.87.2-microsoft-standard-WSL2',
            variables: { WSL_DISTRO_NAME: 'Ubuntu' }
          },
          commandRunner: recordingRunner(commands)
        }
      )
    )

    expect(result).toEqual({ _tag: 'Opened' })
    expect(commands).toEqual([
      {
        executable: 'powershell.exe',
        arguments: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '& { param([string]$ReadinessUrl, [string]$ReadinessAuthority) try { Invoke-WebRequest -UseBasicParsing -Method Head -TimeoutSec 3 -Uri $ReadinessUrl -Headers @{ Host = $ReadinessAuthority } | Out-Null } catch { exit 1 } }',
          'http://127.0.0.1:4312/health',
          'localhost:4312'
        ]
      },
      {
        executable: 'powershell.exe',
        arguments: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '& { param([string]$BrowserUrl) Start-Process -FilePath $BrowserUrl }',
          browserUrl
        ]
      }
    ])
  })

  it.runIf(canExecutePowerShell)(
    'passes WSL forwarding values as executable PowerShell parameters',
    async () => {
      let receivedHost: string | undefined
      const readinessServer = createServer((request, response) => {
        receivedHost = request.headers.host
        response.statusCode = 204
        response.end()
      })
      const port = await new Promise<number>((resolve, reject) => {
        readinessServer.once('error', reject)
        readinessServer.listen({ host: '127.0.0.1', port: 0 }, () => {
          const address = readinessServer.address()
          if (!address || typeof address === 'string') {
            reject(new TypeError('Expected a TCP listener'))
            return
          }
          resolve(address.port)
        })
      })
      const expectedAuthority = `rebase-parameter-test.localhost:${port}`
      const commands: BrowserCommand[] = []
      const commandRunner: BrowserCommandRunner = (command) =>
        Effect.suspend(() => {
          commands.push(command)
          if (command.arguments.some((argument) => argument.includes('Invoke-WebRequest'))) {
            return runBrowserCommand({
              ...command,
              executable: localPowerShellExecutable
            })
          }
          return Effect.void
        })

      try {
        const result = await Effect.runPromise(
          openBrowser(
            {
              browserUrl: `http://${expectedAuthority}/auth/a-ticket`,
              readinessUrl: `http://${expectedAuthority}/health`
            },
            {
              environment: {
                platform: 'linux',
                release: '6.6.87.2-microsoft-standard-WSL2',
                variables: { WSL_DISTRO_NAME: 'Ubuntu' }
              },
              commandRunner
            }
          )
        )

        expect(result).toEqual({ _tag: 'Opened' })
        expect(receivedHost).toBe(expectedAuthority)
        expect(commands).toHaveLength(2)
      } finally {
        await new Promise<void>((resolve) => readinessServer.close(() => resolve()))
      }
    }
  )

  it('prints local-forwarding instructions instead of opening from a headless SSH session', async () => {
    const commands: BrowserCommand[] = []

    const result = await Effect.runPromise(
      openBrowser(
        { browserUrl, readinessUrl },
        {
          environment: {
            platform: 'linux',
            release: '6.6.87.2-microsoft-standard-WSL2',
            variables: { SSH_CONNECTION: 'client 123 server 22', WSL_DISTRO_NAME: 'Ubuntu' }
          },
          commandRunner: recordingRunner(commands)
        }
      )
    )

    expect(result).toEqual({
      _tag: 'Instructions',
      reason: 'HeadlessSsh',
      instructions: [
        'Rebase cannot open your workstation browser from this SSH session.',
        'From a local terminal, run:',
        'ssh -N -L 4312:127.0.0.1:4312 <ssh-host>',
        `Then open ${browserUrl}`
      ]
    })
    expect(commands).toEqual([])
  })

  it('keeps the Server usable when WSL localhost forwarding cannot be verified', async () => {
    const commands: BrowserCommand[] = []
    const commandRunner: BrowserCommandRunner = (command) =>
      Effect.sync(() => commands.push(command)).pipe(
        Effect.andThen(
          Effect.fail(
            new BrowserCommandFailure({
              executable: command.executable,
              message: 'Windows could not reach the Server'
            })
          )
        )
      )

    const result = await Effect.runPromise(
      openBrowser(
        { browserUrl, readinessUrl },
        {
          environment: {
            platform: 'linux',
            release: '6.6.87.2-microsoft-standard-WSL2',
            variables: { WSL_INTEROP: '/run/WSL/1_interop' }
          },
          commandRunner
        }
      )
    )

    expect(result).toEqual({
      _tag: 'Instructions',
      reason: 'ForwardingUnavailable',
      instructions: [
        'Windows localhost forwarding could not reach the Rebase Server.',
        `Rebase is still running at ${browserUrl}`
      ]
    })
    expect(commands).toHaveLength(1)
    expect(commands[0]?.executable).toBe('powershell.exe')
  })
})
