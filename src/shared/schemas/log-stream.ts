import { Schema } from 'effect'

const nonNegativeInteger = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))
const positiveInteger = Schema.Number.pipe(Schema.int(), Schema.positive())

export const LogStreamRequestSchema = Schema.Struct({
  repoPath: Schema.String,
  skip: Schema.optional(nonNegativeInteger),
  maxCount: Schema.optional(positiveInteger),
  streamId: Schema.optional(Schema.Number.pipe(Schema.int()))
})
export type LogStreamRequest = typeof LogStreamRequestSchema.Type
export type LogStreamOptions = Pick<LogStreamRequest, 'skip' | 'maxCount' | 'streamId'>
