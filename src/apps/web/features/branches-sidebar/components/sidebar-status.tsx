import type { JSX } from "react";
import type {
  BranchesSidebarRow,
  BranchesSidebarScope,
} from "#web/features/branches-sidebar/branches-sidebar.contract";
import {
  describeEmptyBranchesSidebar,
  describeRepositoryRefsError,
} from "#web/features/branches-sidebar/branches-sidebar-messages";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";
import { Button } from "#web-ui/components/ui/button";

export function SidebarStatus({
  onRetry,
  query,
  rows,
  scope,
  snapshot,
}: {
  readonly onRetry: () => void;
  readonly query: string;
  readonly rows: readonly BranchesSidebarRow[];
  readonly scope: BranchesSidebarScope;
  readonly snapshot: RepositoryRefsSnapshot;
}): JSX.Element | null {
  if (snapshot.error !== undefined) {
    return (
      <div className="px-2 py-3 text-xs text-status-unavailable" role="alert">
        <p>{describeRepositoryRefsError(snapshot.error)}</p>
        <Button className="mt-2" onClick={onRetry} size="xs" variant="outline">
          Retry
        </Button>
      </div>
    );
  }
  if (snapshot.refs === undefined) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground" role="status">
        {snapshot.status === "loading"
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
