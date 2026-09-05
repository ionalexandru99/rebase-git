import { Schema } from "effect";

export const environmentAccessCapabilities = [
  "environment.read",
  "repository.read",
  "repository.write",
  "history.rewrite",
  "worktree.manage",
  "authorization.manage",
  "environment.manage",
] as const;

export const EnvironmentAccessCapability = Schema.Literals(
  environmentAccessCapabilities,
);
export type EnvironmentAccessCapability =
  typeof EnvironmentAccessCapability.Type;
