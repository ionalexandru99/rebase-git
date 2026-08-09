import { Schema } from 'effect4'

export const CLIENT_BOOTSTRAP_PATH = '/api/bootstrap'
export const CLIENT_CSRF_HEADER = 'X-Rebase-CSRF-Token'
export const RENDERER_BUILD_HEADER = 'X-Rebase-Renderer-Build-Id'
export const SERVER_INSTANCE_HEADER = 'X-Rebase-Server-Instance-Id'

const ClientPathSchema = Schema.String.check(Schema.isLengthBetween(1, 4096))
const ClientSecretSchema = Schema.String.check(Schema.isLengthBetween(1, 256))

export const ClientBootstrapSchema = Schema.Struct({
  environment: Schema.Struct({
    environmentId: Schema.Literal('local'),
    path: ClientPathSchema
  }),
  readOnly: Schema.Boolean,
  csrfToken: ClientSecretSchema
})

export type ClientBootstrap = typeof ClientBootstrapSchema.Type
