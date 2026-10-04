import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";
import {
  HorizontalScrollButton,
  horizontalScrollViewport,
  useHorizontalScroll,
} from "#web/components/ui/horizontal-scroll.tsx";
import { CommitRefPill } from "#web/features/commit-graph/components/commit-ref-labels.tsx";
import type {
  HistoryScope,
  HistorySelection,
} from "#web/features/commit-graph/scope/history-scope.ts";

export function HistoryScopeStrip({
  onRemove,
  onReset,
  roots,
  scope,
  selections,
}: {
  readonly onRemove: ((target: HistorySelection) => void) | undefined;
  readonly onReset?: (() => void) | undefined;
  readonly roots: readonly RepositoryHistoryRefTarget[];
  readonly scope: HistoryScope;
  readonly selections: readonly HistorySelection[];
}) {
  const detachedHead = roots.find((root) => root.type === "head");
  const { viewport, content, edges, measure, scroll, onKeyDown } =
    useHorizontalScroll();
  return (
    <fieldset className="flex h-9 min-w-0 shrink-0 items-center gap-1.5 border-border/60 border-b bg-[var(--filters-background)] px-3 [--filters-background:color-mix(in_srgb,var(--muted)_20%,var(--repository))]">
      <legend className="sr-only">{scope._tag} history scope</legend>
      <span className="mr-1 shrink-0 text-[.85rem] text-muted-foreground">
        Filters
      </span>
      <div className="relative h-full min-w-0 flex-1">
        <section
          ref={viewport}
          aria-label="Filters"
          className={horizontalScrollViewport}
          onKeyDown={onKeyDown}
          onScroll={measure}
          tabIndex={edges.left || edges.right ? 0 : -1}
        >
          <div ref={content} className="flex h-full w-max items-center gap-1.5">
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
                        : selection._tag === "Commit"
                          ? "commit"
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
              <span className="text-[.85rem] text-muted-foreground">
                No refs
              </span>
            ) : null}
          </div>
        </section>
        {edges.left ? (
          <HorizontalScrollButton
            direction={-1}
            label="Scroll filters left"
            background="bg-[var(--filters-background)]"
            onScroll={scroll}
          />
        ) : null}
        {edges.right ? (
          <HorizontalScrollButton
            direction={1}
            label="Scroll filters right"
            background="bg-[var(--filters-background)]"
            onScroll={scroll}
          />
        ) : null}
      </div>
      {scope._tag !== "Custom" || onReset === undefined ? null : (
        <button
          type="button"
          onClick={onReset}
          className="h-6 shrink-0 rounded-sm px-2 text-[.85rem] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
        >
          Reset filters
        </button>
      )}
    </fieldset>
  );
}

function scopeSelectionName(selection: HistorySelection) {
  if (selection._tag === "Commit") return selection.oid.slice(0, 7);
  return selection._tag === "RemoteBranch"
    ? `${selection.remote}/${selection.name}`
    : selection.name;
}

function scopeSelectionKey(selection: HistorySelection) {
  return `${selection._tag}\0${scopeSelectionName(selection)}`;
}
