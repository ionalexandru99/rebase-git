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

// `Schema.Number` accepts NaN; the Zod contracts this migration replaced rejected it. Use this for
// persisted/wire numeric fields so a NaN can never round-trip into the store or the renderer.
export const NonNaNNumber = Schema.NonNaN

// Trims and rejects empty — the canonical non-empty request string shared by the sidecar HTTP
// registry and the @effect/rpc payload schemas, so both validate request fields identically.
export const RequiredString = Schema.Trim.pipe(Schema.minLength(1))

export const OpaqueString = Schema.String.pipe(Schema.minLength(1))
export const OpaqueHunkHeaderString = Schema.String.pipe(Schema.pattern(/\S/))
