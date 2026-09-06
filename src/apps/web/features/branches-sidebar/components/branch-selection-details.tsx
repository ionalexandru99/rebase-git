import type { BranchesSidebarRefRow } from "#web/features/branches-sidebar/branches-sidebar.contract";

export function BranchSelectionDetails({
  row,
}: {
  readonly row: BranchesSidebarRefRow;
}) {
  return (
    <section
      aria-label="Selected branch"
      className="mx-3 mb-3 shrink-0 border-t border-sidebar-border pt-3 text-xs"
    >
      <p className="break-all font-medium text-sidebar-accent-foreground">
        {row.target._tag === "RemoteBranch"
          ? `${row.target.remote}/${row.name}`
          : row.name}
      </p>
      {row.current ? (
        <p className="mt-1 text-muted-foreground">Current branch</p>
      ) : null}
      {row.checkout === undefined ? null : (
        <>
          <p className="mt-1 text-muted-foreground">
            {row.checkout.kind === "repository"
              ? "Repository"
              : "Linked worktree"}
          </p>
          <p className="mt-1 break-all font-mono text-muted-foreground">
            {row.checkout.path}
          </p>
        </>
      )}
    </section>
  );
}
