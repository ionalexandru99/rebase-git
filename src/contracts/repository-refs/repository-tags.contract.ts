import { Schema } from "effect";
import { repositoryCommand } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
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

export const CreateRepositoryTag = Schema.Struct({
  ...TagScope,
  name: RefName,
  target: ObjectId,
});
export type CreateRepositoryTag = typeof CreateRepositoryTag.Type;

export const DeleteRepositoryTag = Schema.Struct({
  ...TagScope,
  name: RefName,
});
export type DeleteRepositoryTag = typeof DeleteRepositoryTag.Type;

export const RepositoryTagDeleted = Schema.Struct({
  name: RefName,
});
export type RepositoryTagDeleted = typeof RepositoryTagDeleted.Type;

export const TagRejected = Schema.TaggedStruct("TagRejected", {
  reason: Schema.Literals(["InvalidName", "Exists"]),
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
    failure: RefMissing,
  }),
};
