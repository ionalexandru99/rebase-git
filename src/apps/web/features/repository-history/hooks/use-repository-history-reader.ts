import { useEffect, useState } from "react";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import type {
  RepositoryHistoryGateway,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";

export function useRepositoryHistoryReader(
  gateway: RepositoryHistoryGateway,
  environmentId: string | undefined,
  repositoryId: string | undefined,
  logicalRepositoryId: string | undefined,
) {
  const [connection, setConnection] = useState<{
    readonly key: string;
    readonly reader: RepositoryHistoryReader;
  }>();
  const key = JSON.stringify([
    environmentId,
    repositoryId,
    logicalRepositoryId,
  ]);
  useEffect(() => {
    if (
      environmentId === undefined ||
      repositoryId === undefined ||
      logicalRepositoryId === undefined
    )
      return;
    const reader = createBrowserRepositoryHistoryReader({
      gateway,
      environmentId,
      repositoryId,
      logicalRepositoryId,
    });
    setConnection({ key, reader });
    return () => reader.close();
  }, [gateway, environmentId, repositoryId, logicalRepositoryId, key]);
  return connection?.key === key ? connection.reader : undefined;
}
