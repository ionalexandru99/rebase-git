import { IconDatabase, IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  SettingsRow,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import { formatCacheSize } from "#web/features/history-storage/format-cache-size.ts";
import { formatLastOpened } from "#web/features/open-project/open-project-state.ts";
import {
  RepositoryBadge,
  repositoryColors,
} from "#web/features/repository-catalog/repository-badge.tsx";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";
import type {
  HistoryCache,
  HistoryStorage,
} from "#web/features/repository-history/history-worker-protocol.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";

interface StoredHistory {
  readonly cache: HistoryCache;
  readonly repository: RepositoryCatalogEntry | undefined;
  readonly name: string;
  readonly detail: string;
  readonly label: string;
}

interface Catalog {
  readonly repositories: readonly RepositoryCatalogEntry[];
  readonly loaded: boolean;
}

export function HistoryStorageBreakdown({
  storage,
  pending,
  onClear,
  clearAll,
}: {
  readonly storage: HistoryStorage;
  readonly pending: boolean;
  readonly onClear: (cache: HistoryCache) => void;
  readonly clearAll?: ReactNode;
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
        <SettingsSection title="Usage · This browser">
          <div className="space-y-2.5 px-3 py-3 sm:px-4">
            <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground/80">
              <span>
                <span className="text-sm font-medium text-foreground tabular-nums">
                  {formatCacheSize(storage.usageBytes)}
                </span>{" "}
                used
              </span>
              {storage.quotaBytes === undefined ? null : (
                <span>
                  {formatCacheSize(
                    Math.max(0, storage.quotaBytes - storage.usageBytes),
                  )}{" "}
                  available
                </span>
              )}
            </div>
            {commitCount === 0 ? null : (
              <div
                aria-hidden="true"
                className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
              >
                {histories
                  .filter(({ cache }) => cache.commitCount > 0)
                  .map(({ cache, repository }) => (
                    <span
                      className="h-full bg-muted-foreground"
                      key={cacheKey(cache)}
                      style={{
                        width: `${(cache.commitCount / commitCount) * 100}%`,
                        ...(repository === undefined
                          ? {}
                          : {
                              backgroundColor:
                                repositoryColors[repository.color],
                            }),
                      }}
                    />
                  ))}
              </div>
            )}
          </div>
        </SettingsSection>
      )}
      <SettingsSection action={clearAll} title="Repositories">
        {histories.map(({ cache, repository, name, detail, label }) => (
          <SettingsRow
            description={`${detail} · ${cache.commitCount.toLocaleString()} commits · ${
              cache.open
                ? "Open now"
                : `Last opened ${formatLastOpened(new Date(cache.lastOpenedAt).toISOString())}`
            }`}
            icon={
              repository === undefined ? (
                <IconDatabase
                  aria-hidden="true"
                  className="size-4.5 text-muted-foreground"
                />
              ) : (
                <RepositoryBadge
                  className="size-5 rounded-[5px] text-[.5625rem]"
                  color={repository.color}
                  name={repository.name}
                />
              )
            }
            key={cacheKey(cache)}
            title={name}
            value={formatCacheSize(cache.estimatedBytes)}
          >
            <Button
              aria-label={label}
              disabled={pending}
              onClick={() => onClear(cache)}
              size="icon-xs"
              variant="ghost"
            >
              <IconTrash aria-hidden="true" className="size-4" />
            </Button>
          </SettingsRow>
        ))}
        {histories.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
            No history stored yet.
          </p>
        )}
      </SettingsSection>
    </>
  );
}

function storedHistories(
  caches: readonly HistoryCache[],
  catalog: Catalog,
  environmentId: string | undefined,
): readonly StoredHistory[] {
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
          repository,
          ...unnamed,
          label: `Clear history for ${unnamed.name.toLowerCase()} with ${cache.commitCount.toLocaleString()} commits`,
        };
      }
      return {
        cache,
        repository,
        name: repository.name,
        detail: repository.path,
        label: `Clear history for ${repository.name}`,
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
