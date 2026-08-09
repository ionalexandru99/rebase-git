import { spawn, type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { Effect, Scope } from 'effect4'
import type { AgentReadyRecord } from '../../src/common/features/agent-connection'
import {
  AgentProcessMonitorError,
  readAgentAnnouncement,
  type AgentProcessExit
} from '../../src/server/features/agent-connection'
import {
  type AgentProxy,
  type AgentProxyAction,
  type AgentProxyExchange,
  startAgentProxy
} from './server-agent-proxy'

export interface AgentProcessFixture {
  readonly child: ChildProcess
  readonly agentExited: Effect.Effect<AgentProcessExit, AgentProcessMonitorError>
  readonly ready: AgentReadyRecord
  readonly proxy: AgentProxy
  readonly stdoutAfterAnnouncement: () => string
}

export type AgentProxyDecision = (exchange: AgentProxyExchange) => AgentProxyAction

export function buildAgent(): void {
  execFileSync('pnpm', ['build:agent'], { stdio: 'pipe' })
}

export function monitorProcess(
  child: ChildProcess
): Effect.Effect<AgentProcessExit, AgentProcessMonitorError> {
  return Effect.callback((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.succeed({ code: child.exitCode, signal: child.signalCode }))
      return
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      resume(Effect.succeed({ code, signal }))
    }
    const onError = (detail: Error) => {
      cleanup()
      resume(
        Effect.fail(
          new AgentProcessMonitorError({
            message: 'Agent process monitor failed',
            detail
          })
        )
      )
    }
    const cleanup = () => {
      child.off('exit', onExit)
      child.off('error', onError)
    }
    child.once('exit', onExit)
    child.once('error', onError)
    return Effect.sync(cleanup)
  })
}

function spawnAgent(): ChildProcess {
  return spawn(
    process.execPath,
    [
      'out/agent/index.js',
      '--heartbeat-interval-ms',
      '20',
      '--orphan-timeout-ms',
      '5000',
      '--shutdown-grace-ms',
      '250'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
}

function stopAgent(child: ChildProcess): Effect.Effect<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Effect.void
  }
  return Effect.sync(() => child.kill('SIGKILL')).pipe(
    Effect.andThen(monitorProcess(child)),
    Effect.timeout(2_000),
    Effect.ignore
  )
}

export function acquireAgentProcess(
  decide: AgentProxyDecision = () => 'forward'
): Effect.Effect<AgentProcessFixture, unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const child = yield* Effect.acquireRelease(Effect.sync(spawnAgent), stopAgent)
    const agentExited = monitorProcess(child)
    const ready = yield* readAgentAnnouncement(child.stdout!, agentExited, 2_000)
    const stdoutChunks: Buffer[] = []
    const onStdout = (chunk: Buffer | string) => {
      stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => child.stdout!.on('data', onStdout)),
      () => Effect.sync(() => child.stdout!.off('data', onStdout))
    )
    const proxy = yield* Effect.acquireRelease(
      Effect.tryPromise(() => startAgentProxy(ready.port, decide)),
      (acquired) => Effect.promise(acquired.close)
    )
    return {
      child,
      agentExited,
      ready: { ...ready, port: proxy.port },
      proxy,
      stdoutAfterAnnouncement: () => Buffer.concat(stdoutChunks).toString('utf8')
    }
  })
}
