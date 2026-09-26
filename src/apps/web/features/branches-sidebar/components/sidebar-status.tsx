import type { JSX } from "react";
import { Button } from "#web/components/ui/button";
import type {
  BranchesSidebarRow,
  BranchesSidebarScope,
} from "#web/features/branches-sidebar/branches-sidebar.contract";
import { describeEmptyBranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar-messages";
import type { RepositoryRefsRead } from "#web/features/repository-refs/hooks/use-repository-refs";

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
      <div className="px-2 py-3 text-xs text-status-unavailable" role="alert">
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
      <p className="px-2 py-3 text-xs text-muted-foreground" role="status">
        {repositoryRefs.loading
          ? "Loading branches…"
          : "No repository selected."}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground" role="status">
        {describeEmptyBranchesSidebar(scope, query)}
      </p>
    );
  }
  return null;
}
