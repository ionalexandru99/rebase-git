import {
  type EnvironmentHttpRoute,
  repositoryCommand,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  ObjectId,
  RefName,
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import {
  RefMissing,
  RepositoryTag,
} from "@rebase/contracts/repository-refs/repository-refs.contract";
import { Schema } from "effect";

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
  target: ObjectId,
});
export type RepositoryTagDeleted = typeof RepositoryTagDeleted.Type;

export const TagRejected = Schema.TaggedStruct("TagRejected", {
  reason: Schema.Literals(["InvalidName", "Exists"]),
});
export type TagRejected = typeof TagRejected.Type;

export const RepositoryTagsHttpApi = {
  create: repositoryCommand("/api/repositories/tags/create", {
    request: CreateRepositoryTag,
    success: RepositoryTag,
    failure: TagRejected,
  }),
  delete: repositoryCommand("/api/repositories/tags/delete", {
    request: DeleteRepositoryTag,
    success: RepositoryTagDeleted,
    failure: RefMissing,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;
