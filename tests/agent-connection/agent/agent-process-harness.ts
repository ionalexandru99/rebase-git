import { type ChildProcess, spawn } from 'node:child_process'
import {
  AGENT_LOOPBACK_HOST,
  AGENT_RPC_PATH,
  AGENT_SESSION_AUTHORIZATION_SCHEME,
  AgentRpcs,
  CLAIM_AGENT_PATH
} from '../../../src/common/features/agent-connection'
import { Effect, Layer } from 'effect4'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect4/unstable/http'
import { RpcClient, type RpcClientError, RpcSerialization } from 'effect4/unstable/rpc'
export { buildAgent } from './build-agent'

type AgentClient = RpcClient.FromGroup<typeof AgentRpcs, RpcClientError.RpcClientError>

export interface AgentProcess {
  readonly child: ChildProcess
  readonly ready: {
    readonly type: string
    readonly port: number
    readonly bootstrapSecret: string
  }
  readonly stderr: () => string
  readonly stdoutAfterReady: () => string
  readonly waitForExit: (timeoutMs?: number) => Promise<{
    readonly code: number | null
    readonly signal: NodeJS.Signals | null
  }>
}

export async function startAgent(
  arguments_: ReadonlyArray<string> = [],
  env: NodeJS.ProcessEnv = process.env
): Promise<AgentProcess> {
  const child = spawn(process.execPath, ['out/agent/index.js', ...arguments_], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const stderrChunks: Buffer[] = []
  const stdoutAfterReadyChunks: Buffer[] = []
  child.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const ready = await new Promise<AgentProcess['ready']>((resolve, reject) => {
    let buffered = ''
    let settled = false
    const readinessTimeoutMs = 10_000
    const timeout = setTimeout(
      () => fail(new Error(`Agent readiness timed out after ${readinessTimeoutMs}ms`)),
      readinessTimeoutMs
    )
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout!.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const fail = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (child.exitCode !== null || child.signalCode !== null || !child.kill('SIGKILL')) {
        reject(error)
        return
      }
      child.once('exit', () => reject(error))
    }
    const onError = (error: Error) => fail(error)
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      fail(new Error(`Agent exited before readiness: code=${code} signal=${signal}`))
    const onData = (chunk: Buffer | string) => {
      buffered += chunk.toString()
      const newline = buffered.indexOf('\n')
      if (newline < 0) {
        return
      }
      const remainder = buffered.slice(newline + 1)
      try {
        const parsed = JSON.parse(buffered.slice(0, newline)) as AgentProcess['ready']
        settled = true
        cleanup()
        if (remainder.length > 0) {
          stdoutAfterReadyChunks.push(Buffer.from(remainder))
        }
        child.stdout!.on('data', (later: Buffer) => stdoutAfterReadyChunks.push(later))
        resolve(parsed)
      } catch (error) {
        fail(error)
      }
    }
    child.stdout!.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })

  return {
    child,
    ready,
    stderr: () => Buffer.concat(stderrChunks).toString('utf8'),
    stdoutAfterReady: () => Buffer.concat(stdoutAfterReadyChunks).toString('utf8'),
    waitForExit: (timeoutMs = 2_000) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Agent did not exit within ${timeoutMs}ms`)),
          timeoutMs
        )
        exit.then(
          (result) => {
            clearTimeout(timeout)
            resolve(result)
          },
          (error) => {
            clearTimeout(timeout)
            reject(error)
          }
        )
      })
  }
}

export async function stopAgent(agent: AgentProcess): Promise<void> {
  if (agent.child.exitCode === null && agent.child.signalCode === null) {
    agent.child.kill('SIGKILL')
    await agent.waitForExit().catch(() => undefined)
  }
}

export async function claimAgent(agent: AgentProcess, bootstrapSecret = agent.ready.bootstrapSecret) {
  return fetch(`http://${AGENT_LOOPBACK_HOST}:${agent.ready.port}${CLAIM_AGENT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bootstrapSecret })
  })
}

export function runAgentRpc<A, E>(
  agent: AgentProcess,
  sessionToken: string,
  use: (client: AgentClient) => Effect.Effect<A, E>
): Promise<A> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
        const protocol = RpcClient.layerProtocolHttp({
          url: `http://${AGENT_LOOPBACK_HOST}:${agent.ready.port}${AGENT_RPC_PATH}`,
          transformClient: (client) =>
            client.pipe(
              HttpClient.mapRequest(
                HttpClientRequest.setHeader(
                  'authorization',
                  `${AGENT_SESSION_AUTHORIZATION_SCHEME} ${sessionToken}`
                )
              )
            )
        }).pipe(
          Layer.provide(RpcSerialization.layerNdjson),
          Layer.provide(Layer.succeed(HttpClient.HttpClient)(httpClient))
        )
        const context = yield* Layer.build(protocol)
        const client = yield* RpcClient.make(AgentRpcs).pipe(Effect.provide(context))
        return yield* use(client)
      })
    )
  )
}
