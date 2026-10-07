import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import type {
  BranchesSidebarRow,
  BranchesSidebarScope,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";
import type { RepositoryRefsRead } from "#web/features/refs/repository-refs.ts";

export function SidebarStatus({
  query,
  repositoryRefs,
  rows,
  scope,
}: {
  readonly query: string;
  readonly repositoryRefs: RepositoryRefsRead;
  readonly rows: readonly BranchesSidebarRow[];
  readonly scope: BranchesSidebarScope;
}): JSX.Element | null {
  if (repositoryRefs.error !== null) {
    return (
      <div className="px-2 py-3 text-meta text-status-unavailable" role="alert">
        <p>{repositoryRefs.error}</p>
        <Button
          className="mt-2"
          onClick={repositoryRefs.retry}
          size="xs"
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );
  }
  if (repositoryRefs.refs === undefined) {
    return (
      <p className="px-2 py-3 text-meta text-muted-foreground" role="status">
        {repositoryRefs.loading
          ? "Loading branches…"
          : "No repository selected."}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-2 py-3 text-meta text-muted-foreground" role="status">
        {describeEmptyBranchesSidebar(scope, query)}
      </p>
    );
  }
  return null;
}

function describeEmptyBranchesSidebar(
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
    case "stashes":
      return matching ? "No stashes match." : "No stashes.";
    default:
      return matching ? "No branches match." : "No branches or tags.";
  }
}
