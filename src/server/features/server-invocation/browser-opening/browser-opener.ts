import { spawn } from 'node:child_process'
import os from 'node:os'
import { Data, Effect } from 'effect4'

export interface BrowserCommand {
  readonly executable: string
  readonly arguments: readonly string[]
  readonly completion: 'exit' | 'launch'
}

export class BrowserCommandFailure extends Data.TaggedError('BrowserCommandFailure')<{
  readonly executable: string
  readonly message: string
  readonly cause?: unknown
}> {}

export type BrowserCommandRunner = (
  command: BrowserCommand
) => Effect.Effect<void, BrowserCommandFailure>

export interface BrowserOpeningEnvironment {
  readonly platform: NodeJS.Platform
  readonly release: string
  readonly variables: Readonly<Record<string, string | undefined>>
}

export interface BrowserOpeningRequest {
  readonly browserUrl: string
  readonly readinessUrl: string
}

export type BrowserOpeningOutcome =
  | { readonly _tag: 'Opened' }
  | {
      readonly _tag: 'Instructions'
      readonly reason: 'ForwardingUnavailable' | 'Headless' | 'HeadlessSsh' | 'LaunchFailed'
      readonly instructions: readonly string[]
    }

export interface OpenBrowserOptions {
  readonly environment?: BrowserOpeningEnvironment
  readonly commandRunner?: BrowserCommandRunner
}

export const runBrowserCommand: BrowserCommandRunner = (command) =>
  Effect.callback<void, BrowserCommandFailure>((resume) => {
    let settled = false
    const complete = (effect: Effect.Effect<void, BrowserCommandFailure>) => {
      if (settled) {
        return
      }
      settled = true
      resume(effect)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command.executable, [...command.arguments], {
        detached: command.completion === 'launch',
        stdio: 'ignore',
        windowsHide: true
      })
    } catch (error) {
      resume(
        Effect.fail(
          new BrowserCommandFailure({
            executable: command.executable,
            message: `Could not start ${command.executable}`,
            cause: error
          })
        )
      )
      return
    }
    const fail = (error: unknown) =>
      complete(
        Effect.fail(
          new BrowserCommandFailure({
            executable: command.executable,
            message: `Could not run ${command.executable}`,
            cause: error
          })
        )
      )
    child.once('error', fail)
    if (command.completion === 'launch') {
      child.once('spawn', () => {
        child.off('error', fail)
        child.unref()
        complete(Effect.void)
      })
    } else {
      child.once('exit', (code, signal) => {
        child.off('error', fail)
        if (code === 0) {
          complete(Effect.void)
        } else {
          fail(new Error(`${command.executable} exited with code ${code} signal ${signal}`))
        }
      })
    }
    return Effect.sync(() => {
      child.removeAllListeners()
      if (!settled && child.exitCode === null && child.signalCode === null) {
        child.kill()
      }
    })
  })

export function openBrowser(
  request: BrowserOpeningRequest,
  options: OpenBrowserOptions = {}
): Effect.Effect<BrowserOpeningOutcome> {
  const environment: BrowserOpeningEnvironment = options.environment ?? {
    platform: process.platform,
    release: os.release(),
    variables: process.env
  }
  const commandRunner = options.commandRunner ?? runBrowserCommand
  const variables = environment.variables
  const isGraphical = variables.DISPLAY !== undefined || variables.WAYLAND_DISPLAY !== undefined
  const isSsh =
    variables.SSH_CLIENT !== undefined ||
    variables.SSH_CONNECTION !== undefined ||
    variables.SSH_TTY !== undefined
  if (isSsh && !isGraphical) {
    const port = new URL(request.browserUrl).port
    return Effect.succeed({
      _tag: 'Instructions',
      reason: 'HeadlessSsh',
      instructions: [
        'Rebase cannot open your workstation browser from this SSH session.',
        'From a local terminal, run:',
        `ssh -N -L ${port}:127.0.0.1:${port} <ssh-host>`,
        `Then open ${request.browserUrl}`
      ]
    })
  }
  const launchWithInstructions = (command: BrowserCommand): Effect.Effect<BrowserOpeningOutcome> =>
    commandRunner(command).pipe(
      Effect.as({ _tag: 'Opened' } as const),
      Effect.catchTag('BrowserCommandFailure', () =>
        Effect.succeed({
          _tag: 'Instructions' as const,
          reason: 'LaunchFailed' as const,
          instructions: [`Open ${request.browserUrl} manually.`]
        })
      )
    )
  const windowsOpening = launchWithInstructions({
    executable: 'powershell.exe',
    arguments: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Start-Process -FilePath $args[0]',
      request.browserUrl
    ],
    completion: 'launch'
  })
  const isWsl =
    environment.platform === 'linux' &&
    (environment.variables.WSL_INTEROP !== undefined ||
      environment.variables.WSL_DISTRO_NAME !== undefined ||
      environment.release.toLowerCase().includes('microsoft'))
  if (isWsl) {
    const forwardingVerification = commandRunner({
      executable: 'powershell.exe',
      arguments: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'try { Invoke-WebRequest -UseBasicParsing -Method Head -TimeoutSec 3 -Uri $args[0] | Out-Null } catch { exit 1 }',
        request.readinessUrl
      ],
      completion: 'exit'
    })
    return forwardingVerification.pipe(
      Effect.matchEffect({
        onFailure: () =>
          Effect.succeed({
            _tag: 'Instructions' as const,
            reason: 'ForwardingUnavailable' as const,
            instructions: [
              'Windows localhost forwarding could not reach the Rebase Server.',
              `Rebase is still running at ${request.browserUrl}`
            ]
          }),
        onSuccess: () => windowsOpening
      })
    )
  }
  if (environment.platform === 'darwin') {
    return launchWithInstructions({
      executable: 'open',
      arguments: [request.browserUrl],
      completion: 'launch'
    })
  }
  if (environment.platform === 'linux' && !isGraphical) {
    return Effect.succeed({
      _tag: 'Instructions',
      reason: 'Headless',
      instructions: [`Open ${request.browserUrl} manually.`]
    })
  }
  if (environment.platform === 'linux') {
    return launchWithInstructions({
      executable: 'xdg-open',
      arguments: [request.browserUrl],
      completion: 'launch'
    })
  }
  return windowsOpening
}
