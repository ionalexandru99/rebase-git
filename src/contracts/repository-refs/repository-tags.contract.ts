import { z } from "zod";
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

const TagMessage = z.string().min(1).max(65_536);

export const CreateRepositoryTag = z.object({
  ...TagScope,
  name: RefName,
  target: ObjectId,
  message: TagMessage.optional(),
});
export type CreateRepositoryTag = z.infer<typeof CreateRepositoryTag>;

export const DeleteRepositoryTag = z.object({
  ...TagScope,
  name: RefName,
  local: z.object({ object: ObjectId }).optional(),
  remote: z.object({ remote: RemoteName, object: ObjectId }).optional(),
});
export type DeleteRepositoryTag = z.infer<typeof DeleteRepositoryTag>;

export const RepositoryTagDeleted = z.object({
  name: RefName,
});
export type RepositoryTagDeleted = z.infer<typeof RepositoryTagDeleted>;

export const ReadRepositoryTag = z.object({
  ...TagScope,
  name: RefName,
});
export type ReadRepositoryTag = z.infer<typeof ReadRepositoryTag>;

export const RepositoryTagAnnotation = z.object({
  name: RefName,
  object: ObjectId,
  target: ObjectId,
  tagger: z.object({
    name: z.string().max(512),
    date: z.string().max(64),
  }),
  message: z.string().max(65_536),
  signed: z.boolean(),
});
export type RepositoryTagAnnotation = z.infer<typeof RepositoryTagAnnotation>;

export const TagRejected = z.object({
  _tag: z.literal("TagRejected"),
  reason: z.enum([
    "InvalidName",
    "Exists",
    "MessageRequired",
    "Moved",
    "RemoteDiffers",
  ]),
});
export type TagRejected = z.infer<typeof TagRejected>;

export const RepositoryTagsApi = {
  create: repositoryCommand("repositories/tags/create", {
    request: CreateRepositoryTag,
    success: RepositoryTag,
    failure: TagRejected,
  }),
  delete: repositoryCommand("repositories/tags/delete", {
    request: DeleteRepositoryTag,
    success: RepositoryTagDeleted,
    failure: z.discriminatedUnion("_tag", [RefMissing, TagRejected]),
  }),
  annotation: repositoryQuery("repositories/tags/annotation", {
    request: ReadRepositoryTag,
    success: RepositoryTagAnnotation,
    failure: RefMissing,
  }),
};
