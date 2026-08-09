import { AGENT_WIRE_DECODE_OPTIONS, AgentRpcs } from '@common/features/agent-connection'
import { Result, Schema } from 'effect4'
import { RpcSerialization } from 'effect4/unstable/rpc'

export type AgentRpcRejection = 'MalformedRpc' | 'ServerOwnedField'

const serverOwnedFields = new Set([
  'agentEndpoint',
  'browserSession',
  'credential',
  'environmentId',
  'serverEndpoint',
  'sshTarget',
  'tunnel',
  'wslDistribution'
])

function containsServerOwnedField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsServerOwnedField)
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  return Object.entries(value).some(
    ([key, nested]) => serverOwnedFields.has(key) || containsServerOwnedField(nested)
  )
}

export function validateRpcRequest(rawBody: string): AgentRpcRejection | undefined {
  let frames: ReadonlyArray<unknown>
  try {
    frames = RpcSerialization.makeNdjson({ maxBufferSize: Buffer.byteLength(rawBody) })
      .makeUnsafe()
      .decode(rawBody)
  } catch {
    return 'MalformedRpc'
  }
  if (frames.length === 0 || containsServerOwnedField(frames)) {
    return frames.length === 0 ? 'MalformedRpc' : 'ServerOwnedField'
  }
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object' || !('_tag' in frame)) {
      return 'MalformedRpc'
    }
    if (frame._tag !== 'Request') {
      continue
    }
    if (!('tag' in frame) || typeof frame.tag !== 'string' || !('payload' in frame)) {
      return 'MalformedRpc'
    }
    const rpc = AgentRpcs.requests.get(frame.tag)
    if (
      !rpc ||
      Result.isFailure(
        Schema.decodeUnknownResult(
          Schema.toCodecJson(rpc.payloadSchema),
          AGENT_WIRE_DECODE_OPTIONS
        )(frame.payload)
      )
    ) {
      return 'MalformedRpc'
    }
  }
  return undefined
}
