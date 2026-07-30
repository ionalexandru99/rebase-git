import { ParseResult, Schema } from 'effect'

export function parseOrThrow<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
  return Schema.decodeUnknownSync(schema)(value)
}

export const parseEither = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknownEither(schema)

export const formatParseError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error)

export const mutableArray = <A, I>(item: Schema.Schema<A, I>) => Schema.mutable(Schema.Array(item))

export const NonNaNNumber = Schema.NonNaN

export const RequiredString = Schema.Trim.pipe(Schema.minLength(1))

export const OpaqueString = Schema.String.pipe(Schema.minLength(1))
export const OpaqueHunkHeaderString = Schema.String.pipe(Schema.pattern(/\S/))
