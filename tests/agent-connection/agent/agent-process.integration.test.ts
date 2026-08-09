import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AGENT_LOOPBACK_HOST,
  AGENT_PROTOCOL,
  AGENT_RPC_PATH,
  AGENT_SESSION_AUTHORIZATION_SCHEME,
  AgentHandshakeRequired,
  AgentProtocolMismatch,
  CLAIM_AGENT_PATH
} from '../../../src/common/features/agent-connection'
import { Deferred, Effect, Fiber, Ref, Stream } from 'effect4'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildAgent,
  claimAgent,
  runAgentRpc,
  startAgent,
  stopAgent
} from './agent-process-harness'

beforeAll(buildAgent)

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      await readFile(filePath)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function waitForProcessExit(processId: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Process ${processId} remained alive`)
}

describe.sequential('Agent process boundary', () => {
  it('announces a loopback-only endpoint and rejects invalid or replayed authority claims', async () => {
    const agent = await startAgent(['--orphan-timeout-ms', '5000'])
    try {
      expect(agent.ready.type).toBe('ready')
      expect(agent.ready.port).toBeGreaterThan(0)
      expect(AGENT_LOOPBACK_HOST).toBe('127.0.0.1')

      const nonLoopbackAddress = Object.values(networkInterfaces())
        .flatMap((addresses) => addresses ?? [])
        .find((address) => address.family === 'IPv4' && !address.internal)?.address
      if (nonLoopbackAddress) {
        await expect(
          fetch(`http://${nonLoopbackAddress}:${agent.ready.port}/bootstrap`, {
            method: 'POST',
            signal: AbortSignal.timeout(500)
          })
        ).rejects.toThrow()
      }

      const bootstrapEndpoint = `http://${AGENT_LOOPBACK_HOST}:${agent.ready.port}${CLAIM_AGENT_PATH}`
      const malformedClaim = await fetch(bootstrapEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bootstrapSecret: agent.ready.bootstrapSecret,
          serverEndpoint: 'forbidden'
        })
      })
      expect(malformedClaim.status).toBe(400)
      expect((await claimAgent(agent, 'x'.repeat(43))).status).toBe(401)
      const claim = await claimAgent(agent)
      const { sessionToken } = await claim.json()
      expect(claim.status).toBe(200)
      expect(typeof sessionToken).toBe('string')
      expect((await claimAgent(agent)).status).toBe(409)
    } finally {
      await stopAgent(agent)
    }
  })

  it('rejects invalid bearer authority and Server-owned routing fields', async () => {
    const agent = await startAgent(['--orphan-timeout-ms', '5000'])
    try {
      const claim = await claimAgent(agent)
      const { sessionToken } = await claim.json()
      const endpoint = `http://${AGENT_LOOPBACK_HOST}:${agent.ready.port}${AGENT_RPC_PATH}`
      const unauthorized = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Basic ${sessionToken}` },
        body: '{}\n'
      })
      expect(unauthorized.status).toBe(401)

      const forbiddenRouting = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `${AGENT_SESSION_AUTHORIZATION_SCHEME} ${sessionToken}`
        },
        body: `${JSON.stringify({
          _tag: 'Request',
          id: 0,
          tag: 'pingAgent',
          payload: { requestId: 'strict-routing', serverEndpoint: 'forbidden' }
        })}\n`
      })
      expect(forbiddenRouting.status).toBe(400)
      await expect(forbiddenRouting.json()).resolves.toEqual({
        _tag: 'AgentTransportRejected',
        reason: 'ServerOwnedField'
      })
    } finally {
      await stopAgent(agent)
    }
  })

  it('returns typed handshake and exact protocol failures before accepting a session', async () => {
    const agent = await startAgent(['--orphan-timeout-ms', '5000'])
    try {
      const claim = await claimAgent(agent)
      const { sessionToken } = await claim.json()

      await expect(
        runAgentRpc(agent, sessionToken, (client) =>
          client.pingAgent({ requestId: 'before-handshake' })
        )
      ).rejects.toBeInstanceOf(AgentHandshakeRequired)
      await expect(
        runAgentRpc(agent, sessionToken, (client) =>
          client.openAgentSession({ agentProtocol: AGENT_PROTOCOL + 1 })
        )
      ).rejects.toMatchObject(
        new AgentProtocolMismatch({ expected: AGENT_PROTOCOL, received: AGENT_PROTOCOL + 1 })
      )

      const opened = await runAgentRpc(agent, sessionToken, (client) =>
        client.openAgentSession({ agentProtocol: AGENT_PROTOCOL })
      )
      expect(opened.agentProtocol).toBe(AGENT_PROTOCOL)
    } finally {
      await stopAgent(agent)
    }
  })

  it.runIf(process.platform !== 'win32')(
    'propagates an aborted open-session RPC into Git process-tree termination',
    async () => {
      const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'rebase-agent-rpc-git-'))
      const executable = path.join(fixtureDirectory, 'git')
      const pidFile = path.join(fixtureDirectory, 'pid')
      await writeFile(
        executable,
        [
          '#!/bin/sh',
          'echo $$ > "$REBASE_AGENT_GIT_PID_FILE"',
          "trap '' TERM",
          'while true',
          'do',
          '  sleep 1',
          'done'
        ].join('\n')
      )
      await chmod(executable, 0o755)
      const agent = await startAgent(
        [
          '--orphan-timeout-ms',
          '5000',
          '--git-termination-grace-ms',
          '50',
          '--shutdown-grace-ms',
          '50'
        ],
        {
          ...process.env,
          PATH: `${fixtureDirectory}:${process.env.PATH ?? ''}`,
          REBASE_AGENT_GIT_PID_FILE: pidFile
        }
      )

      try {
        const claim = await claimAgent(agent)
        const { sessionToken } = await claim.json()
        await runAgentRpc(agent, sessionToken, (client) =>
          Effect.gen(function* () {
            const opening = yield* client
              .openAgentSession({ agentProtocol: AGENT_PROTOCOL })
              .pipe(Effect.forkChild)
            yield* Effect.promise(() => waitForFile(pidFile))
            yield* Fiber.interrupt(opening)
          })
        )
        const gitProcessId = Number((await readFile(pidFile, 'utf8')).trim())
        await waitForProcessExit(gitProcessId)
        await expect(
          runAgentRpc(agent, sessionToken, (client) =>
            client.pingAgent({ requestId: 'cancelled-open-session' })
          )
        ).rejects.toBeInstanceOf(AgentHandshakeRequired)
      } finally {
        await stopAgent(agent)
        await rm(fixtureDirectory, { recursive: true, force: true })
      }
    }
  )

  it('keeps unary RPC responsive while a real HTTP/RPC stream consumer stalls', async () => {
    const agent = await startAgent([
      '--heartbeat-interval-ms',
      '1',
      '--orphan-timeout-ms',
      '5000'
    ])
    try {
      const claim = await claimAgent(agent)
      const { sessionToken } = await claim.json()
      const result = await runAgentRpc(agent, sessionToken, (client) =>
        Effect.gen(function* () {
          const compatibility = yield* client.openAgentSession({ agentProtocol: AGENT_PROTOCOL })
          const firstDelivered = yield* Deferred.make<void>()
          const releaseConsumer = yield* Deferred.make<void>()
          const threeDelivered = yield* Deferred.make<void>()
          const delivered = yield* Ref.make<ReadonlyArray<number>>([])
          const consumer = yield* client
            .observeAgent({}, { streamBufferSize: 1 })
            .pipe(
              Stream.runForEach((observation) =>
                Effect.gen(function* () {
                  const current = yield* Ref.updateAndGet(delivered, (existing) => [
                    ...existing,
                    observation.sequence
                  ])
                  if (current.length === 1) {
                    yield* Deferred.succeed(firstDelivered, undefined)
                    yield* Deferred.await(releaseConsumer)
                  }
                  if (current.length === 3) {
                    yield* Deferred.succeed(threeDelivered, undefined)
                  }
                })
              ),
              Effect.forkChild
            )
          yield* Deferred.await(firstDelivered)
          yield* Effect.sleep(250)
          const ping = yield* client.pingAgent({ requestId: 'during-slow-stream-consumer' })
          yield* Deferred.succeed(releaseConsumer, undefined)
          yield* Deferred.await(threeDelivered).pipe(Effect.timeout(2_000))
          yield* Fiber.interrupt(consumer)
          return {
            sequences: yield* Ref.get(delivered),
            ping,
            streamBufferEvents: compatibility.limits.streamBufferEvents
          }
        })
      )

      expect(result.streamBufferEvents).toBe(64)
      expect(result.ping.requestId).toBe('during-slow-stream-consumer')
      expect(result.sequences[0]).toBe(1)
      expect(result.sequences[1]).toBeGreaterThan(result.sequences[0] ?? 0)
      expect(result.sequences[2]).toBeGreaterThan(result.sequences[1] ?? 0)
    } finally {
      await stopAgent(agent)
    }
  })

  it('exits as an orphan while its internal heartbeat publisher is active', async () => {
    const agent = await startAgent([
      '--heartbeat-interval-ms',
      '5',
      '--orphan-timeout-ms',
      '100',
      '--shutdown-grace-ms',
      '50'
    ])
    const exit = await agent.waitForExit()

    expect(exit).toEqual({ code: 0, signal: null })
    expect(agent.stderr()).toContain('agent-orphan-timeout')
    expect(agent.stderr()).toContain('agent-stopped')
  })

  it.runIf(process.platform !== 'win32')(
    'gracefully closes scoped resources after a signal and writes no extra stdout',
    async () => {
      const agent = await startAgent([
        '--orphan-timeout-ms',
        '5000',
        '--shutdown-grace-ms',
        '50'
      ])
      const claim = await claimAgent(agent)
      const { sessionToken } = await claim.json()
      await runAgentRpc(agent, sessionToken, (client) =>
        client.openAgentSession({ agentProtocol: AGENT_PROTOCOL })
      )
      agent.child.kill('SIGTERM')
      const exit = await agent.waitForExit()
      const log = agent.stderr()

      expect(exit).toEqual({ code: 0, signal: null })
      expect(log).toContain('agent-signal-received')
      expect(log).toContain('agent-stopped')
      expect(log).not.toContain(agent.ready.bootstrapSecret)
      expect(log).not.toContain(sessionToken)
      expect(log.trimEnd().split('\n').every((line) => Buffer.byteLength(line) < 8 * 1024)).toBe(
        true
      )
      expect(agent.stdoutAfterReady()).toBe('')
    }
  )
})
