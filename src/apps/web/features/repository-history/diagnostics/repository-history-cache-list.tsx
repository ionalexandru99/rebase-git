import type { RepositoryHistoryCacheIdentity } from "#web/features/repository-history/diagnostics/repository-history-cache-dialog.contract";
import type { RepositoryHistoryStorageDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";

export function RepositoryHistoryCacheList({
  diagnostics,
  identity,
  repositoryName,
}: {
  readonly diagnostics: RepositoryHistoryStorageDiagnostics;
  readonly identity: RepositoryHistoryCacheIdentity;
  readonly repositoryName: string;
}) {
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Browser storage</dt>
          <dd>{diagnostics.persistent ? "Persistent" : "Best effort"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Origin usage / quota</dt>
          <dd>
            {formatBytes(diagnostics.usageBytes)} /{" "}
            {formatBytes(diagnostics.quotaBytes)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Cache sizes are estimates. Origin usage includes other app data. Open
        repositories are protected from automatic eviction.
      </p>
      <div className="max-h-64 overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Repository history caches</caption>
          <thead className="sticky top-0 bg-popover text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Repository</th>
              <th className="px-3 py-2 font-medium">History</th>
              <th className="px-3 py-2 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.caches.map((cache) => {
              const current =
                cache.environmentId === identity.environmentId &&
                cache.repositoryId === identity.repositoryId;
              return (
                <tr
                  className="border-t border-border align-top"
                  key={`${cache.environmentId}/${cache.repositoryId}`}
                >
                  <td className="max-w-64 px-3 py-2">
                    <div className="break-all font-medium">
                      {current ? repositoryName : cache.repositoryId}
                      {current && " (current)"}
                    </div>
                    <div className="mt-1 break-all text-muted-foreground">
                      Environment: {cache.environmentId}
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {cache.lastOpenedAt === undefined
                        ? "Never opened"
                        : `Last opened ${new Date(cache.lastOpenedAt).toLocaleString()}`}
                    </div>
                    {cache.open && <div className="mt-1">Open · Protected</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="capitalize">{cache.state}</div>
                    <div className="mt-1 whitespace-nowrap text-muted-foreground">
                      {cache.commitCount.toLocaleString()} commits
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatBytes(cache.estimatedBytes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {diagnostics.caches.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            No history caches.
          </p>
        )}
      </div>
    </>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "Unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
