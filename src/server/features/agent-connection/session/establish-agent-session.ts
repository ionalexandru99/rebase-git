import {
  AGENT_PROTOCOL,
  AGENT_RPC_PATH,
  AGENT_SESSION_AUTHORIZATION_SCHEME,
  AgentRpcs,
  type OpenAgentSessionSuccess
} from '@common/features/agent-connection'
import { Effect, Layer, type Scope } from 'effect4'
import { HttpClient, HttpClientRequest } from 'effect4/unstable/http'
import { RpcClient, type RpcClientError, RpcSerialization } from 'effect4/unstable/rpc'
import type { AgentConnectionFailure } from '../failure/agent-connection-failure'
import {
  classifyAgentCommunicationFailure,
  isRecoverableAgentCommunicationFailure,
  malformedAgentCommunication
} from '../failure/classify-agent-communication-failure'
import type { AgentLiveness } from '../lifecycle/agent-liveness'

export type AgentInterfaceClient = RpcClient.FromGroup<
  typeof AgentRpcs,
  RpcClientError.RpcClientError
>

export interface EstablishedAgentSession {
  readonly client: AgentInterfaceClient
  readonly compatibility: OpenAgentSessionSuccess
}

export function establishAgentSession(
  baseUrl: string,
  sessionToken: string,
  httpClient: HttpClient.HttpClient,
  liveness: AgentLiveness,
  timeoutMs: number
): Effect.Effect<EstablishedAgentSession, AgentConnectionFailure, Scope.Scope> {
  return Effect.gen(function* () {
    const protocolLayer = RpcClient.layerProtocolHttp({
      url: `${baseUrl}${AGENT_RPC_PATH}`,
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
    const protocolContext = yield* Layer.build(protocolLayer)
    const client = yield* RpcClient.make(AgentRpcs).pipe(Effect.provide(protocolContext))
    const openSession = liveness
      .whileConnected(
        client.openAgentSession({ agentProtocol: AGENT_PROTOCOL }).pipe(
          Effect.timeout(timeoutMs),
          Effect.catchDefect((detail) =>
            Effect.fail(
              malformedAgentCommunication(detail, 'Agent session negotiation', 'MalformedHandshake')
            )
          )
        )
      )
      .pipe(
        Effect.mapError((error) =>
          classifyAgentCommunicationFailure(
            error,
            'Agent session negotiation',
            'MalformedHandshake'
          )
        )
      )
    const compatibility = yield* openSession.pipe(
      Effect.retry({ times: 1, while: isRecoverableAgentCommunicationFailure })
    )

    return { client, compatibility }
  })
}
