import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  RemoteName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";
import {
  RefMissing,
  RepositoryTag,
} from "#contracts/repository-refs/repository-refs.contract.ts";

const TagScope = {
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
};

const TagMessage = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(65_536),
);

export const CreateRepositoryTag = Schema.Struct({
  ...TagScope,
  name: RefName,
  target: ObjectId,
  message: Schema.optional(TagMessage),
});
export type CreateRepositoryTag = typeof CreateRepositoryTag.Type;

export const DeleteRepositoryTag = Schema.Struct({
  ...TagScope,
  name: RefName,
  local: Schema.optional(Schema.Struct({ object: ObjectId })),
  remote: Schema.optional(
    Schema.Struct({ remote: RemoteName, object: ObjectId }),
  ),
});
export type DeleteRepositoryTag = typeof DeleteRepositoryTag.Type;

export const RepositoryTagDeleted = Schema.Struct({
  name: RefName,
});
export type RepositoryTagDeleted = typeof RepositoryTagDeleted.Type;

export const ReadRepositoryTag = Schema.Struct({
  ...TagScope,
  name: RefName,
});
export type ReadRepositoryTag = typeof ReadRepositoryTag.Type;

export const RepositoryTagAnnotation = Schema.Struct({
  name: RefName,
  object: ObjectId,
  target: ObjectId,
  tagger: Schema.Struct({
    name: Schema.String.check(Schema.isMaxLength(512)),
    date: Schema.String.check(Schema.isMaxLength(64)),
  }),
  message: Schema.String.check(Schema.isMaxLength(65_536)),
  signed: Schema.Boolean,
});
export type RepositoryTagAnnotation = typeof RepositoryTagAnnotation.Type;

export const TagRejected = Schema.TaggedStruct("TagRejected", {
  reason: Schema.Literals([
    "InvalidName",
    "Exists",
    "MessageRequired",
    "Moved",
    "RemoteDiffers",
  ]),
});
export type TagRejected = typeof TagRejected.Type;

export const RepositoryTagsApi = {
  create: repositoryCommand("repositories/tags/create", {
    request: CreateRepositoryTag,
    success: RepositoryTag,
    failure: TagRejected,
  }),
  delete: repositoryCommand("repositories/tags/delete", {
    request: DeleteRepositoryTag,
    success: RepositoryTagDeleted,
    failure: Schema.Union([RefMissing, TagRejected]),
  }),
  annotation: repositoryQuery("repositories/tags/annotation", {
    request: ReadRepositoryTag,
    success: RepositoryTagAnnotation,
    failure: RefMissing,
  }),
};
