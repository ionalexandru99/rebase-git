import type {
  EnvironmentAccessCapability,
  EnvironmentAuthorizationRole,
} from "@rebase/contracts";

const viewerCapabilities = [
  "environment.read",
  "repository.read",
] as const satisfies ReadonlyArray<EnvironmentAccessCapability>;

const contributorCapabilities = [
  ...viewerCapabilities,
  "repository.write",
] as const satisfies ReadonlyArray<EnvironmentAccessCapability>;

const maintainerCapabilities = [
  ...contributorCapabilities,
  "history.rewrite",
  "worktree.manage",
] as const satisfies ReadonlyArray<EnvironmentAccessCapability>;

const ownerCapabilities = [
  ...maintainerCapabilities,
  "authorization.manage",
  "environment.manage",
] as const satisfies ReadonlyArray<EnvironmentAccessCapability>;

export function capabilitiesForRole(
  role: EnvironmentAuthorizationRole,
  customCapabilities: ReadonlyArray<EnvironmentAccessCapability>,
): ReadonlyArray<EnvironmentAccessCapability> {
  switch (role) {
    case "viewer":
      return viewerCapabilities;
    case "contributor":
      return contributorCapabilities;
    case "maintainer":
      return maintainerCapabilities;
    case "owner":
      return ownerCapabilities;
    case "custom":
      return [...new Set(customCapabilities)];
  }
}
