import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
  route,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

const IdentityValue = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
);

export const GitIdentity = Schema.Struct({
  name: Schema.optionalKey(IdentityValue),
  email: Schema.optionalKey(IdentityValue),
});
export type GitIdentity = typeof GitIdentity.Type;

export const RepositoryIdentity = Schema.Struct({
  local: GitIdentity,
  inherited: GitIdentity,
});
export type RepositoryIdentity = typeof RepositoryIdentity.Type;

export const IdentityFailed = Schema.TaggedStruct("IdentityFailed", {
  detail: Schema.String.check(Schema.isMaxLength(2_048)),
});
export type IdentityFailed = typeof IdentityFailed.Type;

export const GitIdentityApi = {
  read: route("git-identity/read", {
    success: GitIdentity,
    failure: IdentityFailed,
  }),
  save: route("git-identity/save", {
    request: GitIdentity,
    success: GitIdentity,
    failure: IdentityFailed,
  }),
  readRepository: repositoryQuery("repositories/identity", {
    request: Schema.Struct({ repositoryId: RepositoryId }),
    success: RepositoryIdentity,
  }),
  saveRepository: repositoryCommand("repositories/save-identity", {
    request: Schema.Struct({
      repositoryId: RepositoryId,
      identity: GitIdentity,
    }),
    success: RepositoryIdentity,
  }),
};
