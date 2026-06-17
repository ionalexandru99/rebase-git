import { Schema } from 'effect'

export const LogStreamRequestSchema = Schema.Struct({
  repoPath: Schema.String,
  skip: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  maxCount: Schema.optional(Schema.Int.pipe(Schema.positive())),
  streamId: Schema.optional(Schema.Int)
})
export type LogStreamRequest = typeof LogStreamRequestSchema.Type
export type LogStreamOptions = Pick<LogStreamRequest, 'skip' | 'maxCount' | 'streamId'>
