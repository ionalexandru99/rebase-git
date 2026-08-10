import { Effect, Ref } from 'effect4'

export interface ServerDiagnosticsOptions {
  readonly maxEntryBytes: number
  readonly maxRecentEntries: number
  readonly writeLine: (line: string) => void
}

export interface ServerDiagnostics {
  readonly registerSecret: (secret: string) => Effect.Effect<void>
  readonly record: (
    event: string,
    fields?: Readonly<Record<string, unknown>>
  ) => Effect.Effect<void>
  readonly recentLines: Effect.Effect<ReadonlyArray<string>>
}

interface ServerDiagnosticsState {
  readonly secrets: ReadonlySet<string>
  readonly recentLines: ReadonlyArray<string>
}

function redactText(value: string, secrets: ReadonlySet<string>): string {
  const registeredSecrets = [...secrets].sort((left, right) => right.length - left.length)
  let redacted = ''
  let index = 0
  while (index < value.length) {
    if (value.startsWith('/auth/', index)) {
      const nonceStart = index + '/auth/'.length
      let nonceEnd = nonceStart
      while (nonceEnd < value.length && !/[/?#\s"]/.test(value[nonceEnd])) {
        nonceEnd += 1
      }
      if (nonceEnd > nonceStart) {
        redacted += '/auth/[redacted]'
        index = nonceEnd
        continue
      }
    }

    const secret = registeredSecrets.find((candidate) => value.startsWith(candidate, index))
    if (secret !== undefined) {
      redacted += '[redacted]'
      index += secret.length
      continue
    }
    redacted += value[index]
    index += 1
  }
  return redacted
}

function redactValue(
  value: unknown,
  secrets: ReadonlySet<string>,
  ancestors: Set<object>
): unknown {
  if (typeof value === 'string') {
    return redactText(value, secrets)
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (ancestors.has(value)) {
    return '[circular]'
  }

  ancestors.add(value)
  const redacted = Array.isArray(value)
    ? value.map((item) => redactValue(item, secrets, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          redactText(key, secrets),
          redactValue(item, secrets, ancestors)
        ])
      )
  ancestors.delete(value)
  return redacted
}

function encodePayload(
  event: string,
  fields: Readonly<Record<string, unknown>>,
  secrets: ReadonlySet<string>
): string {
  try {
    const redactedFields = redactValue(fields, secrets, new Set()) as Record<string, unknown>
    return JSON.stringify({ ...redactedFields, event: redactText(event, secrets) })
  } catch {
    return JSON.stringify({ event: redactText(event, secrets), serializationFailure: true })
  }
}

function boundedEntry(
  event: string,
  fields: Readonly<Record<string, unknown>>,
  secrets: ReadonlySet<string>,
  maxEntryBytes: number
): string {
  const encoded = encodePayload(event, fields, secrets)
  if (Buffer.byteLength(`${encoded}\n`) <= maxEntryBytes) {
    return encoded
  }
  const redactedEvent = redactText(event, secrets)
  const truncated = JSON.stringify({ event: redactedEvent, truncated: true })
  if (Buffer.byteLength(`${truncated}\n`) <= maxEntryBytes) {
    return truncated
  }

  const eventCharacters = Array.from(redactedEvent)
  while (eventCharacters.length > 0) {
    eventCharacters.pop()
    const candidate = JSON.stringify({ event: eventCharacters.join(''), truncated: true })
    if (Buffer.byteLength(`${candidate}\n`) <= maxEntryBytes) {
      return candidate
    }
  }
  return JSON.stringify({ truncated: true })
}

export function makeServerDiagnostics(
  options: ServerDiagnosticsOptions
): Effect.Effect<ServerDiagnostics> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => {
      if (!Number.isInteger(options.maxEntryBytes) || options.maxEntryBytes < 32) {
        throw new RangeError('maxEntryBytes must be an integer of at least 32')
      }
      if (!Number.isInteger(options.maxRecentEntries) || options.maxRecentEntries < 0) {
        throw new RangeError('maxRecentEntries must be a non-negative integer')
      }
    })
    const state = yield* Ref.make<ServerDiagnosticsState>({
      secrets: new Set(),
      recentLines: []
    })

    return {
      registerSecret: (secret) =>
        Ref.update(state, (current) => ({
          ...current,
          secrets: secret.length === 0 ? current.secrets : new Set([...current.secrets, secret])
        })),
      record: (event, fields = {}) =>
        Effect.gen(function* () {
          const encoded = yield* Ref.modify(state, (current) => {
            const nextEntry = boundedEntry(event, fields, current.secrets, options.maxEntryBytes)
            const recentLines =
              options.maxRecentEntries === 0
                ? []
                : [...current.recentLines, nextEntry].slice(-options.maxRecentEntries)
            return [nextEntry, { ...current, recentLines }]
          })
          yield* Effect.sync(() => options.writeLine(`${encoded}\n`))
        }),
      recentLines: Ref.get(state).pipe(Effect.map((current) => [...current.recentLines]))
    }
  })
}
