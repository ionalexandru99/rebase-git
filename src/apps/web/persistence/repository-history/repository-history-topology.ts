import {
  commitStoreName,
  readRepositoryRecord,
  repositoryCommitRange,
  repositoryStoreName,
  requestResult,
  topologyStoreName,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/persistence/repository-history/repository-history-database";
import type { StoredCommit } from "#web/persistence/repository-history/repository-history-database.contract";

export interface HistoryTopology {
  readonly oids: readonly string[];
  readonly parents: Uint32Array;
  readonly offsets: Uint32Array;
  readonly timestamps: Float64Array;
}

export function readStoredHistoryTopology(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined,
  build: (
    readChunk: (after: string | undefined) => Promise<StoredCommit[]>,
  ) => Promise<HistoryTopology>,
  isCurrent: () => boolean,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName, topologyStoreName],
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const topologies = transaction.objectStore(topologyStoreName);
    let topology: HistoryTopology | undefined;
    try {
      const repository = await readRepositoryRecord(
        transaction.objectStore(repositoryStoreName),
        environmentId,
        repositoryId,
      );
      if (repository === undefined) {
        topology = await build(async () => []);
        await completed;
        return topology;
      }
      topology = await requestResult<HistoryTopology | undefined>(
        topologies.get(repository.id),
      );
      if (topology === undefined) {
        topology = await build((after) =>
          isCurrent()
            ? requestResult<StoredCommit[]>(
                transaction
                  .objectStore(commitStoreName)
                  .getAll(repositoryCommitRange(repository.id, after), 2_048),
              )
            : Promise.resolve([]),
        );
        if (isCurrent()) topologies.put(topology, repository.id);
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
