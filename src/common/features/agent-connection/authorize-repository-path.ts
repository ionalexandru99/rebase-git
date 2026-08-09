import { Schema } from 'effect4'

export const RepositoryPathRejectionReasonSchema = Schema.Literals([
  'FilesystemFailure',
  'MalformedPath',
  'NotDirectory',
  'NotFound',
  'OutsideAllowedRoots'
])

export type RepositoryPathRejectionReason = typeof RepositoryPathRejectionReasonSchema.Type

export class RepositoryPathRejected extends Schema.TaggedError<RepositoryPathRejected>()(
  'RepositoryPathRejected',
  { reason: RepositoryPathRejectionReasonSchema }
) {}

export const AuthorizedRepositoryPathSchema = Schema.Struct({
  canonicalPath: Schema.String
})

export type AuthorizedRepositoryPath = typeof AuthorizedRepositoryPathSchema.Type
