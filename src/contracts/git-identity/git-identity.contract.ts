import { z } from "zod";
import { settingRoutes } from "#contracts/settings/setting-routes.contract.ts";

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

export const GitIdentityApi = settingRoutes("git-identity", {
  value: SavedIdentity,
  choice: GitIdentity,
  repository: RepositoryIdentity,
});
