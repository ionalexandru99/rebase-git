import type { HistoryTopology } from "#web/domain/repository-history/history-topology.contract";
import {
  commitStoreName,
  repositoryCommitRange,
  requestResult,
  topologyStoreName,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/persistence/repository-history/repository-history-database";
import type { StoredCommit } from "#web/persistence/repository-history/repository-history-database.contract";

export function readStoredHistoryTopology(
  key: string,
  indexedDB: IDBFactory | undefined,
  build: (
    readChunk: (after: string | undefined) => Promise<StoredCommit[]>,
  ) => Promise<HistoryTopology>,
  isCurrent: () => boolean,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, topologyStoreName],
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const topologies = transaction.objectStore(topologyStoreName);
    let topology: HistoryTopology | undefined;
    try {
      topology = await requestResult<HistoryTopology | undefined>(
        topologies.get(key),
      );
      if (topology === undefined) {
        topology = await build((after) =>
          isCurrent()
            ? requestResult<StoredCommit[]>(
                transaction
                  .objectStore(commitStoreName)
                  .getAll(repositoryCommitRange(key, after), 2_048),
              )
            : Promise.resolve([]),
        );
        if (isCurrent()) topologies.put(topology, key);
      }
      await completed;
      return topology;
    } catch (error) {
      await completed.catch(() => undefined);
      if (topology !== undefined) return topology;
      throw error;
    }
  });
}
