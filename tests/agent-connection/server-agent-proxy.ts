import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AGENT_LOOPBACK_HOST } from '../../src/common/features/agent-connection'

export type AgentProxyAction =
  | 'forward'
  | 'drop-before-agent'
  | 'drop-during-agent-write'
  | 'drop-after-agent-response'
  | 'malform-agent-response'
  | 'gap-second-observation'

export interface AgentProxyExchange {
  readonly index: number
  readonly path: string
  readonly tags: readonly string[]
  readonly body: string
  upstreamBodyBytes?: number
  responseStatus?: number
  responseBody?: string
}

function writePartialRequest(
  targetPort: number,
  path: string,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  body: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const bodyBytes = Buffer.from(body)
    const partialBytes = Math.max(1, Math.floor(bodyBytes.length / 2))
    const socket = connect(targetPort, AGENT_LOOPBACK_HOST)
    socket.once('error', reject)
    socket.once('connect', () => {
      const forwardedHeaders = Object.entries(headers)
        .filter(
          ([name, value]) =>
            value !== undefined &&
            name.toLowerCase() !== 'host' &&
            name.toLowerCase() !== 'content-length'
        )
        .flatMap(([name, value]) =>
          Array.isArray(value) ? value.map((item) => `${name}: ${item}`) : [`${name}: ${value}`]
        )
      const head = [
        `POST ${path} HTTP/1.1`,
        `Host: ${AGENT_LOOPBACK_HOST}:${targetPort}`,
        `Content-Length: ${bodyBytes.length}`,
        ...forwardedHeaders,
        '',
        ''
      ].join('\r\n')
      socket.write(head)
      socket.write(bodyBytes.subarray(0, partialBytes), () => {
        setTimeout(() => {
          socket.destroy()
          resolve(partialBytes)
        }, 10)
      })
    })
  })
}

export interface AgentProxy {
  readonly port: number
  readonly exchanges: readonly AgentProxyExchange[]
  readonly close: () => Promise<void>
}

function rpcTags(body: string): readonly string[] {
  const tags: string[] = []
  for (const line of body.split('\n')) {
    if (line.length === 0) {
      continue
    }
    try {
      const frame = JSON.parse(line) as { tag?: unknown }
      if (typeof frame.tag === 'string') {
        tags.push(frame.tag)
      }
    } catch {
      continue
    }
  }
  return tags
}

function replaceAgentProtocol(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(replaceAgentProtocol)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      key === 'agentProtocol' ? 'invalid-agent-protocol' : replaceAgentProtocol(child)
    ])
  )
}

function malformedAgentResponse(body: string): string {
  return body
    .split('\n')
    .map((line) => {
      if (line.length === 0) {
        return line
      }
      return JSON.stringify(replaceAgentProtocol(JSON.parse(line) as unknown))
    })
    .join('\n')
}

function sequenceGapTransform(): Transform {
  let buffered = ''
  let observations = 0

  const replaceSecondObservationSequence = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(replaceSecondObservationSequence)
    }
    if (value === null || typeof value !== 'object') {
      return value
    }
    const record = value as Record<string, unknown>
    if (
      (record._tag === 'Heartbeat' || record._tag === 'RepositoryChanged') &&
      typeof record.sequence === 'number'
    ) {
      observations += 1
      return observations === 2 ? { ...record, sequence: record.sequence + 1 } : record
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [
        key,
        replaceSecondObservationSequence(child)
      ])
    )
  }

  const transformLine = (line: string): string => {
    if (line.length === 0) {
      return line
    }
    return JSON.stringify(replaceSecondObservationSequence(JSON.parse(line) as unknown))
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      buffered += chunk.toString('utf8')
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        this.push(`${transformLine(line)}\n`)
      }
      callback()
    },
    flush(callback) {
      if (buffered.length > 0) {
        this.push(transformLine(buffered))
      }
      callback()
    }
  })
}

export async function startAgentProxy(
  targetPort: number,
  decide: (exchange: AgentProxyExchange) => AgentProxyAction = () => 'forward'
): Promise<AgentProxy> {
  const exchanges: AgentProxyExchange[] = []
  const server: Server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const body = Buffer.concat(chunks).toString('utf8')
      const exchange: AgentProxyExchange = {
        index: exchanges.length,
        path: request.url ?? '/',
        tags: rpcTags(body),
        body
      }
      exchanges.push(exchange)
      const action = decide(exchange)
      if (action === 'drop-before-agent') {
        response.destroy()
        return
      }
      if (action === 'drop-during-agent-write') {
        exchange.upstreamBodyBytes = await writePartialRequest(
          targetPort,
          exchange.path,
          request.headers,
          body
        )
        response.destroy()
        return
      }
      const upstream = await fetch(`http://${AGENT_LOOPBACK_HOST}:${targetPort}${exchange.path}`, {
        method: request.method,
        headers: request.headers as HeadersInit,
        body: body.length === 0 ? undefined : body,
        duplex: body.length === 0 ? undefined : 'half'
      } as RequestInit & { duplex?: 'half' })
      exchange.responseStatus = upstream.status
      const headers: Record<string, string> = {}
      upstream.headers.forEach((value, name) => {
        if (
          name === 'content-length' ||
          name === 'content-encoding' ||
          name === 'transfer-encoding'
        ) {
          return
        }
        headers[name] = value
      })
      if (action === 'drop-after-agent-response') {
        exchange.responseBody = await upstream.text()
        response.destroy()
        return
      }
      if (action === 'malform-agent-response') {
        exchange.responseBody = malformedAgentResponse(await upstream.text())
        response.writeHead(upstream.status, {
          ...headers,
          'content-length': String(Buffer.byteLength(exchange.responseBody))
        })
        response.end(exchange.responseBody)
        return
      }
      response.writeHead(upstream.status, headers)
      if (upstream.body) {
        const bodyStream = Readable.fromWeb(
          upstream.body as Parameters<typeof Readable.fromWeb>[0]
        )
        if (action === 'gap-second-observation') {
          await pipeline(bodyStream, sequenceGapTransform(), response)
        } else {
          await pipeline(bodyStream, response)
        }
      } else {
        response.end()
      }
    })().catch(() => response.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, AGENT_LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    port: (server.address() as AddressInfo).port,
    exchanges,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
