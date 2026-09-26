import type { BranchesSidebarScope } from "#web/features/branches-sidebar/branches-sidebar-model";

export function describeEmptyBranchesSidebar(
  scope: BranchesSidebarScope,
  query: string,
): string {
  const matching = query.trim().length > 0;
  switch (scope) {
    case "local":
      return matching ? "No local branches match." : "No local branches.";
    case "remote":
      return matching ? "No remote branches match." : "No remote branches.";
    case "tags":
      return matching ? "No tags match." : "No tags.";
    default:
      return matching ? "No branches match." : "No branches or tags.";
  }
}
