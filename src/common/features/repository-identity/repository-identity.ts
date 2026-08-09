import { Schema } from 'effect4'

const NativePathSchema = Schema.String.check(Schema.isLengthBetween(1, 4096))

export const EnvironmentIdSchema = Schema.String.check(Schema.isLengthBetween(1, 128)).pipe(
  Schema.brand('EnvironmentId')
)

export type EnvironmentId = typeof EnvironmentIdSchema.Type

export const IMPLICIT_LOCAL_ENVIRONMENT_ID = EnvironmentIdSchema.make('local')

export const RepoRefSchema = Schema.Struct({
  environmentId: EnvironmentIdSchema,
  path: NativePathSchema
})

export type RepoRef = typeof RepoRefSchema.Type

export const EnvironmentPathRefSchema = Schema.Struct({
  environmentId: EnvironmentIdSchema,
  path: NativePathSchema
})

export type EnvironmentPathRef = typeof EnvironmentPathRefSchema.Type
