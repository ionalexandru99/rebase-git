import { Schema } from 'effect'

export function parseOrThrow<A, I>(schema: Schema.Schema<A, I, never>, value: unknown): A {
  return Schema.decodeUnknownSync(schema)(value)
}

export function parseEither<A, I>(schema: Schema.Schema<A, I, never>, value: unknown) {
  return Schema.decodeUnknownEither(schema)(value)
}
