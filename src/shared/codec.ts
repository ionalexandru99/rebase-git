import { Either, ParseResult, Schema } from 'effect'

// Decodes an unknown IPC payload through a Schema, throwing a descriptive
// error if it doesn't match. The throw is intentional: drift between main's
// serializer and the renderer's expectations should crash loudly in dev,
// not silently render `undefined`.
export function decodeOrThrow<A, I>(schema: Schema.Schema<A, I>, payload: unknown): A {
  const result = Schema.decodeUnknownEither(schema)(payload)
  if (Either.isRight(result)) return result.right
  throw new Error(
    `IPC payload failed schema decode: ${ParseResult.TreeFormatter.formatErrorSync(result.left)}`
  )
}

export function encodeOrThrow<A, I>(schema: Schema.Schema<A, I>, value: A): I {
  const result = Schema.encodeUnknownEither(schema)(value)
  if (Either.isRight(result)) return result.right as I
  throw new Error(
    `IPC payload failed schema encode: ${ParseResult.TreeFormatter.formatErrorSync(result.left)}`
  )
}
