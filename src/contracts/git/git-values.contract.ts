import { Schema } from "effect";

export const RepositoryId = Schema.String.check(Schema.isUUID(4));
export type RepositoryId = typeof RepositoryId.Type;

export const ObjectId = Schema.String.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
);
export type ObjectId = typeof ObjectId.Type;

export const RepositoryPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4_096),
);
export type RepositoryPath = typeof RepositoryPath.Type;
