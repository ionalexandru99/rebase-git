import { ParseResult, Schema } from 'effect'

/** Validate an IPC/HTTP payload against an Effect Schema; throws a ParseError on mismatch. */
export function parseOrThrow<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
  return Schema.decodeUnknownSync(schema)(value)
}

/** Non-throwing variant: returns an Either whose Left carries the structured parse issue. */
export const parseEither = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknownEither(schema)

/** Render a ParseError as a human-readable tree for logs/telemetry. */
export const formatParseError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error)

/** A mutable array schema, matching the `T[]` (not `readonly T[]`) shape callers expect. */
export const mutableArray = <A, I>(item: Schema.Schema<A, I>) => Schema.mutable(Schema.Array(item))
