import type {
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import type { HistoryScope } from "#web/features/commit-graph/history-scope.contract";
import { CommitRefPill } from "#web-ui/features/commit-graph/components/commit-ref-labels";

export function HistoryScopeStrip({
  onRemove,
  onAdd,
  onReset,
  roots,
  scope,
  selections,
}: {
  readonly onRemove: ((target: RepositoryRefTarget) => void) | undefined;
  readonly onAdd?: (() => void) | undefined;
  readonly onReset?: (() => void) | undefined;
  readonly roots: readonly RepositoryHistoryRefTarget[];
  readonly scope: HistoryScope;
  readonly selections: readonly RepositoryRefTarget[];
}) {
  const detachedHead = roots.find((root) => root.type === "head");
  return (
    <fieldset className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-border/60 border-b bg-muted/20 px-3 py-1">
      <legend className="sr-only">{scope._tag} history scope</legend>
      <span className="mr-1 text-[.85rem] text-muted-foreground">Filters</span>
      {selections.map((selection) => (
        <CommitRefPill
          key={scopeSelectionKey(selection)}
          label={{
            name: scopeSelectionName(selection),
            type:
              selection._tag === "RemoteBranch"
                ? "remote-branch"
                : selection._tag === "Tag"
                  ? "tag"
                  : "branch",
          }}
          onRemove={
            onRemove === undefined ? undefined : () => onRemove(selection)
          }
        />
      ))}
      {selections.length === 0 && detachedHead !== undefined ? (
        <span className="inline-flex h-6 items-center rounded-sm border border-border/70 bg-background/60 px-2 text-[.85rem] text-foreground">
          Detached HEAD
        </span>
      ) : null}
      {selections.length === 0 && detachedHead === undefined ? (
        <span className="text-[.85rem] text-muted-foreground">No refs</span>
      ) : null}
      {onAdd === undefined ? null : (
        <button
          type="button"
          onClick={onAdd}
          className="h-6 rounded-sm px-2 text-[.85rem] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
        >
          + Add ref
        </button>
      )}
      {scope._tag !== "Custom" || onReset === undefined ? null : (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto h-6 rounded-sm px-2 text-[.85rem] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
        >
          Reset filters
        </button>
      )}
    </fieldset>
  );
}

function scopeSelectionName(selection: RepositoryRefTarget) {
  return selection._tag === "RemoteBranch"
    ? `${selection.remote}/${selection.name}`
    : selection.name;
}

function scopeSelectionKey(selection: RepositoryRefTarget) {
  return `${selection._tag}\0${scopeSelectionName(selection)}`;
}
