import type {
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import { IconX } from "@tabler/icons-react";
import type { HistoryScope } from "#web/features/commit-graph/history-scope.contract";

export function HistoryScopeStrip({
  onRemove,
  roots,
  scope,
  selections,
}: {
  readonly onRemove: ((target: RepositoryRefTarget) => void) | undefined;
  readonly roots: readonly RepositoryHistoryRefTarget[];
  readonly scope: HistoryScope;
  readonly selections: readonly RepositoryRefTarget[];
}) {
  const detachedHead = roots.find((root) => root.type === "head");
  return (
    <fieldset className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-border/60 border-b bg-muted/20 px-3 py-1">
      <legend className="sr-only">{scope._tag} history scope</legend>
      <span className="mr-1 text-[10px] text-muted-foreground">Showing</span>
      {selections.map((selection) => (
        <span
          className="inline-flex h-6 max-w-64 items-center gap-1 rounded-sm border border-border/70 bg-background/60 px-2 text-[11px] text-foreground"
          key={scopeSelectionKey(selection)}
        >
          <span className="truncate">{scopeSelectionName(selection)}</span>
          {onRemove === undefined ? null : (
            <button
              aria-label={`Remove ${scopeSelectionName(selection)} from history`}
              className="-mr-1 grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/70"
              onClick={() => onRemove(selection)}
              type="button"
            >
              <IconX aria-hidden="true" className="size-3" />
            </button>
          )}
        </span>
      ))}
      {selections.length === 0 && detachedHead !== undefined ? (
        <span className="inline-flex h-6 items-center rounded-sm border border-border/70 bg-background/60 px-2 text-[11px] text-foreground">
          Detached HEAD
        </span>
      ) : null}
      {selections.length === 0 && detachedHead === undefined ? (
        <span className="text-[11px] text-muted-foreground">No refs</span>
      ) : null}
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
