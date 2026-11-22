import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
  route,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

const IdentityValue = z.string().trim().min(1).max(256);

export const GitIdentity = z.object({
  name: IdentityValue.exactOptional(),
  email: IdentityValue.exactOptional(),
});
export type GitIdentity = z.infer<typeof GitIdentity>;

const SavedIdentity = z.object({
  name: z.string().exactOptional(),
  email: z.string().exactOptional(),
});

export const RepositoryIdentity = z.object({
  local: SavedIdentity,
  inherited: SavedIdentity,
});
export type RepositoryIdentity = z.infer<typeof RepositoryIdentity>;

export const IdentityFailed = z.object({
  _tag: z.literal("IdentityFailed"),
  detail: z.string().max(2_048),
});
export type IdentityFailed = z.infer<typeof IdentityFailed>;

export const GitIdentityApi = {
  read: route("git-identity/read", {
    success: SavedIdentity,
    failure: IdentityFailed,
  }),
  save: route("git-identity/save", {
    request: GitIdentity,
    success: SavedIdentity,
    failure: IdentityFailed,
  }),
  readRepository: repositoryQuery("repositories/identity", {
    request: z.object({ repositoryId: RepositoryId }),
    success: RepositoryIdentity,
  }),
  saveRepository: repositoryCommand("repositories/save-identity", {
    request: z.object({
      repositoryId: RepositoryId,
      identity: GitIdentity,
    }),
    success: RepositoryIdentity,
  }),
};
