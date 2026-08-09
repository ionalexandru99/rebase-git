import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  AGENT_PROTOCOL,
  AGENT_RPC_PATH,
  AGENT_SESSION_AUTHORIZATION_SCHEME,
  AGENT_WIRE_DECODE_OPTIONS,
  AgentClaimRejected,
  AGENT_LOOPBACK_HOST,
  AgentReadyRecordSchema,
  AgentRpcs,
  CLAIM_AGENT_PATH,
  ClaimAgentRequestSchema,
  ClaimAgentSuccessSchema,
  StopAgentResultSchema
} from '../../../src/common/features/agent-connection'
import { Result, Schema } from 'effect4'
import { RpcSchema } from 'effect4/unstable/rpc'
import { describe, expect, it } from 'vitest'
import effectPackage from 'effect4/package.json'
import protocolFixture from './fixtures/protocol-v2.json'

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..')

function schemaDocument(schema: Schema.Top): unknown {
  return Schema.toJsonSchemaDocument(schema, { additionalProperties: false })
}

function agentInterfaceDescriptor() {
  return {
    agentProtocol: AGENT_PROTOCOL,
    transport: {
      implementation: `effect@${effectPackage.version}`,
      serialization: 'effect-rpc-ndjson-over-loopback-http',
      loopbackHost: AGENT_LOOPBACK_HOST,
      claimPath: CLAIM_AGENT_PATH,
      rpcPath: AGENT_RPC_PATH,
      authorizationScheme: AGENT_SESSION_AUTHORIZATION_SCHEME
    },
    decoding: { excessProperties: 'error' },
    claim: {
      announcement: schemaDocument(AgentReadyRecordSchema),
      request: schemaDocument(ClaimAgentRequestSchema),
      success: schemaDocument(ClaimAgentSuccessSchema),
      failure: schemaDocument(AgentClaimRejected)
    },
    rpcs: [...AgentRpcs.requests.values()]
      .sort((left, right) => left._tag.localeCompare(right._tag))
      .map((rpc) => {
        const streamSchemas = RpcSchema.isStreamSchema(rpc.successSchema)
          ? rpc.successSchema
          : undefined
        return {
          tag: rpc._tag,
          stream: streamSchemas !== undefined,
          payload: schemaDocument(rpc.payloadSchema),
          success: schemaDocument(streamSchemas?.success ?? rpc.successSchema),
          failure: schemaDocument(streamSchemas?.error ?? rpc.errorSchema)
        }
      })
  }
}

function stagedSourcePath(fixturePath: string): string {
  const stagedChanges = execFileSync(
    'git',
    ['diff', '--cached', '--find-renames', '--name-status'],
    { cwd: repositoryRoot, encoding: 'utf8' }
  )
  for (const change of stagedChanges.trim().split('\n')) {
    const [status, sourcePath, destinationPath] = change.split('\t')
    if (status?.startsWith('R') && destinationPath === fixturePath && sourcePath) {
      return sourcePath
    }
  }
  return fixturePath
}

function originalTrackedFixture(fixturePath: string): string | undefined {
  const historyPath = stagedSourcePath(fixturePath)
  const creationRevision = execFileSync(
    'git',
    ['log', '--follow', '--diff-filter=A', '--format=%H', '--name-only', '--', historyPath],
    { cwd: repositoryRoot, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean)
  const creationCommit = creationRevision.find((line) => /^[0-9a-f]{40}$/.test(line))
  const creationPath = creationRevision.find((line) => !/^[0-9a-f]{40}$/.test(line))
  if (!creationCommit || !creationPath) {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', fixturePath], {
        cwd: repositoryRoot,
        stdio: 'ignore'
      })
    } catch {
      return undefined
    }
    throw new Error(`Cannot verify the creation revision of tracked fixture ${fixturePath}`)
  }
  return execFileSync('git', ['show', `${creationCommit}:${creationPath}`], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
}

describe('Agent wire interface', () => {
  it('has a deterministic complete descriptor', () => {
    const descriptor = agentInterfaceDescriptor()
    const fingerprint = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')

    expect({ agentProtocol: AGENT_PROTOCOL, descriptorSha256: fingerprint }).toEqual(
      protocolFixture
    )
  })

  it('keeps every published protocol fixture append-only', () => {
    const fixtureDirectory = path.join(import.meta.dirname, 'fixtures')
    const fixtureNames = readdirSync(fixtureDirectory).filter((name) =>
      /^protocol-v\d+\.json$/.test(name)
    )

    for (const fixtureName of fixtureNames) {
      const fixtureFilePath = path.join(fixtureDirectory, fixtureName)
      const fixturePath = path
        .relative(repositoryRoot, fixtureFilePath)
        .split(path.sep)
        .join(path.posix.sep)
      const original = originalTrackedFixture(fixturePath)
      if (original !== undefined) {
        expect(JSON.parse(readFileSync(fixtureFilePath, 'utf8'))).toEqual(JSON.parse(original))
      }
    }
  })

  it('contains only definitive Agent stop results', () => {
    const notDispatched = Schema.decodeUnknownResult(StopAgentResultSchema)({
      _tag: 'NotDispatched',
      operationId: 'operation-1',
      reason: 'ConnectionUnavailable',
      requiresRefresh: false
    })
    const outcomeUnknown = Schema.decodeUnknownResult(StopAgentResultSchema)({
      _tag: 'OutcomeUnknown',
      operationId: 'operation-1',
      requiresRefresh: true
    })

    expect(Result.isFailure(notDispatched)).toBe(true)
    expect(Result.isFailure(outcomeUnknown)).toBe(true)
  })

  it('rejects excess routing fields when decoding wire schemas', () => {
    const claim = Schema.decodeUnknownResult(
      ClaimAgentRequestSchema,
      AGENT_WIRE_DECODE_OPTIONS
    )({
      bootstrapSecret: 'x'.repeat(32),
      environmentId: 'server-owned'
    })
    const stopPayload = AgentRpcs.requests.get('stopAgent')?.payloadSchema

    expect(Result.isFailure(claim)).toBe(true)
    expect(stopPayload).toBeDefined()
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(stopPayload!, AGENT_WIRE_DECODE_OPTIONS)({
          operationId: 'operation-1',
          expectedState: {
            agentProtocol: AGENT_PROTOCOL,
            lifecycle: 'running',
            sshTarget: 'server-owned'
          }
        })
      )
    ).toBe(true)
  })
})
