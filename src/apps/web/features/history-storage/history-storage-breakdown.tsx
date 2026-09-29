import { IconTrash } from "@tabler/icons-react";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { formatCacheSize } from "#web/features/history-storage/format-cache-size.ts";
import { formatLastOpened } from "#web/features/open-project/open-project-state.ts";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";
import type {
  HistoryCache,
  HistoryStorage,
} from "#web/features/repository-history/history-worker-protocol.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";

const repositoryColors = [
  "bg-primary",
  "bg-sky-400",
  "bg-violet-400",
  "bg-green-400",
] as const;

interface StoredHistory {
  readonly cache: HistoryCache;
  readonly name: string;
  readonly detail: string;
  readonly label: string;
  readonly color: string;
}

interface Catalog {
  readonly repositories: readonly RepositoryCatalogEntry[];
  readonly loaded: boolean;
}

export function HistoryStorageBreakdown({
  storage,
  pending,
  onClear,
}: {
  readonly storage: HistoryStorage;
  readonly pending: boolean;
  readonly onClear: (cache: HistoryCache) => void;
}) {
  const { environmentId } = useEnvironment();
  const catalog = useRepositoryCatalog();
  const histories = storedHistories(storage.caches, catalog, environmentId);
  const commitCount = histories.reduce(
    (total, { cache }) => total + cache.commitCount,
    0,
  );
  return (
    <>
      {storage.usageBytes === undefined ? null : (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p>
              <span className="text-xl font-semibold tabular-nums">
                {formatCacheSize(storage.usageBytes)}
              </span>{" "}
              <span className="text-sm text-muted-foreground">used</span>
            </p>
            {storage.quotaBytes === undefined ? null : (
              <p className="text-sm text-muted-foreground">
                {formatCacheSize(storage.quotaBytes)} available in this browser
              </p>
            )}
          </div>
          {commitCount === 0 ? null : (
            <div
              aria-hidden="true"
              className="mt-3 flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
            >
              {histories
                .filter(({ cache }) => cache.commitCount > 0)
                .map(({ cache, color }) => (
                  <span
                    key={cacheKey(cache)}
                    className={`h-full ${color}`}
                    style={{
                      width: `${(cache.commitCount / commitCount) * 100}%`,
                    }}
                  />
                ))}
            </div>
          )}
        </div>
      )}
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Stored repository history</caption>
          <thead className="bg-popover text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Repository</th>
              <th className="px-3 py-2 text-right font-medium">Commits</th>
              <th className="px-3 py-2 font-medium">Last opened</th>
              <th className="px-3 py-2 text-right font-medium">Size</th>
              <th className="w-9">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {histories.map(({ cache, name, detail, label, color }) => (
              <tr className="border-t border-border" key={cacheKey(cache)}>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={`size-2 shrink-0 rounded-full ${color}`}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{name}</div>
                      <div className="mt-0.5 truncate text-muted-foreground">
                        {detail}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
                  {cache.commitCount.toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                  {cache.open
                    ? "Open now"
                    : formatLastOpened(
                        new Date(cache.lastOpenedAt).toISOString(),
                      )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                  {formatCacheSize(cache.estimatedBytes)}
                </td>
                <td className="px-2 py-3">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={label}
                    disabled={pending}
                    onClick={() => onClear(cache)}
                  >
                    <IconTrash />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {histories.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            No history stored yet.
          </p>
        )}
      </div>
    </>
  );
}

function storedHistories(
  caches: readonly HistoryCache[],
  catalog: Catalog,
  environmentId: string | undefined,
): readonly StoredHistory[] {
  let colors = 0;
  return caches
    .filter((cache) => cache.open || cache.commitCount > 0)
    .toSorted((left, right) => right.commitCount - left.commitCount)
    .map((cache) => {
      const repository =
        cache.environmentId === environmentId
          ? catalog.repositories.find(
              ({ id, logicalRepositoryId }) =>
                (logicalRepositoryId ?? id) === cache.repositoryId,
            )
          : undefined;
      if (repository === undefined) {
        const unnamed = unnamedHistory(cache, catalog, environmentId);
        return {
          cache,
          ...unnamed,
          label: `Clear history for ${unnamed.name.toLowerCase()} with ${cache.commitCount.toLocaleString()} commits`,
          color: "bg-muted-foreground",
        };
      }
      const color = repositoryColors[colors++ % repositoryColors.length];
      return {
        cache,
        name: repository.name,
        detail: repository.path,
        label: `Clear history for ${repository.name}`,
        color: color ?? "bg-primary",
      };
    });
}

function unnamedHistory(
  cache: HistoryCache,
  catalog: Catalog,
  environmentId: string | undefined,
) {
  if (cache.environmentId !== environmentId)
    return {
      name: "Unknown repository",
      detail: "From another environment",
    };
  if (!catalog.loaded)
    return {
      name: "Unknown repository",
      detail: "Your project list is unavailable",
    };
  return { name: "Removed repository", detail: "No longer in your projects" };
}

function cacheKey(cache: HistoryCache) {
  return `${cache.environmentId}/${cache.repositoryId}`;
}
