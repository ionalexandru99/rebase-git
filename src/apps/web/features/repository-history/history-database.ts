import type {
  RepositoryCommit,
  RepositoryHistoryTips,
} from "#contracts/repository-history/repository-history.contract.ts";

export const workingChangesStoreName = "workingChanges";
const commitStoreName = "commits";
const repositoryStoreName = "repositories";
const topologyStoreName = "topology";
const recentTopologyStoreName = "recentTopology";
const identityIndexName = "identity";
const databaseName = "rebase-repository-history";
const databaseVersion = 10;
const epochSize = 2 ** 32;

export interface StoredRepository {
  readonly id: number;
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly commitCount: number;
  readonly lastOpenedAt: number;
  readonly minimumEpoch: number;
  readonly tips?: RepositoryHistoryTips;
}

export interface StoredCommit {
  readonly commit: RepositoryCommit;
  readonly epoch: number;
  readonly order: number;
}

export type GraphCommit = Pick<RepositoryCommit, "oid" | "parents"> & {
  readonly committer: Pick<RepositoryCommit["committer"], "timestampSeconds">;
};

export interface StoredGraphCommit {
  readonly commit: GraphCommit;
  readonly epoch: number;
  readonly order: number;
}

export interface StoredTopology {
  readonly oids: readonly string[];
  readonly parents: Int32Array;
  readonly offsets: Uint32Array;
  readonly timestamps: Float64Array;
  readonly missing: readonly (readonly [number, string])[];
}

export class HistoryStorageUnavailable extends Error {
  readonly quotaExceeded: boolean;

  constructor(cause: unknown) {
    super("Browser storage is unavailable", { cause });
    this.quotaExceeded =
      cause instanceof DOMException && cause.name === "QuotaExceededError";
  }
}

let connection: Promise<IDBDatabase> | undefined;

export async function withHistoryDatabase<T>(
  use: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  const database = await sharedDatabase();
  try {
    return await use(database);
  } catch (cause) {
    if (cause instanceof DOMException)
      throw new HistoryStorageUnavailable(cause);
    throw cause;
  }
}

export function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new HistoryStorageUnavailable(request.error));
  });
}

export function transactionCompleted(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(new HistoryStorageUnavailable(transaction.error));
    transaction.onabort = () =>
      reject(new HistoryStorageUnavailable(transaction.error));
  });
}

export function readRepositories() {
  return read([repositoryStoreName], (store) =>
    requestResult<StoredRepository[]>(store(repositoryStoreName).getAll()),
  );
}

export function openRepository(environmentId: string, repositoryId: string) {
  return write([repositoryStoreName], async (store) => {
    const repositories = store(repositoryStoreName);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.index(identityIndexName).get([environmentId, repositoryId]),
    );
    const next = {
      commitCount: 0,
      minimumEpoch: 0,
      ...current,
      environmentId,
      repositoryId,
      lastOpenedAt: Date.now(),
    };
    const id = Number(await requestResult(repositories.put(next)));
    return { ...next, id } satisfies StoredRepository;
  });
}

export function updateRepository(repository: StoredRepository) {
  return write([repositoryStoreName], async (store) => {
    await requestResult(store(repositoryStoreName).put(repository));
  });
}

export function historyRank({ epoch, order }: StoredGraphCommit) {
  return epoch * epochSize + order;
}

export function storeCommits(
  repository: StoredRepository,
  commits: readonly StoredCommit[],
) {
  return write(
    [
      commitStoreName,
      topologyStoreName,
      recentTopologyStoreName,
      repositoryStoreName,
    ],
    async (store) => {
      store(repositoryStoreName).put(repository);
      const stored = store(commitStoreName);
      for (const record of commits)
        stored.put(record, [repository.id, record.commit.oid]);
      const saved = await requestResult(
        store(topologyStoreName).getKey(repository.id),
      );
      if (saved === undefined) return;
      const recent = store(recentTopologyStoreName);
      for (const { commit, epoch, order } of commits)
        recent.put(
          {
            commit: {
              oid: commit.oid,
              parents: commit.parents,
              committer: {
                timestampSeconds: commit.committer.timestampSeconds,
              },
            },
            epoch,
            order,
          } satisfies StoredGraphCommit,
          [repository.id, epoch, order],
        );
    },
  );
}

export function readCommits(repository: number, oids: readonly string[]) {
  return read([commitStoreName], async (store) => {
    const commits = store(commitStoreName);
    const records = await Promise.all(
      oids.map((oid) =>
        requestResult<StoredCommit | undefined>(commits.get([repository, oid])),
      ),
    );
    return records.flatMap((record) =>
      record === undefined ? [] : [record.commit],
    );
  });
}

export function readCommitChunk(
  repository: number,
  after: string | undefined,
  limit: number,
) {
  return read([commitStoreName], (store) =>
    requestResult<StoredCommit[]>(
      store(commitStoreName).getAll(repositoryRange(repository, after), limit),
    ),
  );
}

export function readTopology(repository: number) {
  return read([topologyStoreName, recentTopologyStoreName], async (store) => {
    const [saved, recent] = await Promise.all([
      requestResult<StoredTopology | undefined>(
        store(topologyStoreName).get(repository),
      ),
      requestResult<StoredGraphCommit[]>(
        store(recentTopologyStoreName).getAll(recentRange(repository)),
      ),
    ]);
    return saved === undefined
      ? undefined
      : {
          saved,
          recent: recent.sort(
            (left, right) =>
              right.epoch - left.epoch || left.order - right.order,
          ),
        };
  });
}

export function writeTopology(repository: number, topology: StoredTopology) {
  return write([topologyStoreName, recentTopologyStoreName], async (store) => {
    store(recentTopologyStoreName).delete(recentRange(repository));
    await requestResult(store(topologyStoreName).put(topology, repository));
  });
}

export function clearRepository(
  environmentId: string,
  repositoryId: string,
  remove: boolean,
) {
  return write(
    [
      repositoryStoreName,
      commitStoreName,
      topologyStoreName,
      recentTopologyStoreName,
    ],
    async (store) => {
      const repositories = store(repositoryStoreName);
      const record = await requestResult<StoredRepository | undefined>(
        repositories
          .index(identityIndexName)
          .get([environmentId, repositoryId]),
      );
      if (record === undefined) return;
      store(commitStoreName).delete(repositoryRange(record.id));
      store(topologyStoreName).delete(record.id);
      store(recentTopologyStoreName).delete(recentRange(record.id));
      if (remove) repositories.delete(record.id);
      else
        repositories.put({
          id: record.id,
          environmentId,
          repositoryId,
          commitCount: 0,
          minimumEpoch: 0,
          lastOpenedAt: record.lastOpenedAt,
        } satisfies StoredRepository);
    },
  );
}

type StoreName =
  | typeof commitStoreName
  | typeof repositoryStoreName
  | typeof topologyStoreName
  | typeof recentTopologyStoreName;
type Stores = (name: StoreName) => IDBObjectStore;

function read<T>(
  names: readonly StoreName[],
  use: (store: Stores) => Promise<T>,
): Promise<T> {
  return transact(names, "readonly", use);
}

function write<T>(
  names: readonly StoreName[],
  use: (store: Stores) => Promise<T>,
): Promise<T> {
  return transact(names, "readwrite", use);
}

function transact<T>(
  names: readonly StoreName[],
  mode: IDBTransactionMode,
  use: (store: Stores) => Promise<T>,
) {
  return withHistoryDatabase(async (database) => {
    const transaction = database.transaction(names, mode);
    const completed = transactionCompleted(transaction);
    try {
      const result = await use((name) => transaction.objectStore(name));
      await completed;
      return result;
    } catch (error) {
      completed.catch(() => undefined);
      try {
        transaction.abort();
      } catch {}
      throw error;
    }
  });
}

function repositoryRange(repository: number, after?: string) {
  return IDBKeyRange.bound(
    [repository, after ?? ""],
    [repository, []],
    after !== undefined,
    true,
  );
}

function recentRange(repository: number) {
  return IDBKeyRange.bound([repository], [repository, []]);
}

function sharedDatabase() {
  if (connection !== undefined) return connection;
  const forget = () => {
    if (connection === opened) connection = undefined;
  };
  const opened = openDatabase(forget);
  opened.catch(forget);
  connection = opened;
  return opened;
}

function openDatabase(closed: () => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    let request: IDBOpenDBRequest;
    try {
      request = globalThis.indexedDB.open(databaseName, databaseVersion);
    } catch (cause) {
      reject(new HistoryStorageUnavailable(cause));
      return;
    }
    request.onupgradeneeded = () => recreateHistoryStores(request.result);
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      const database = request.result;
      database.onversionchange = () => {
        closed();
        database.close();
      };
      database.onclose = closed;
      resolve(database);
    };
    request.onerror = () =>
      reject(new HistoryStorageUnavailable(request.error));
    request.onblocked = () => {
      blocked = true;
      reject(new HistoryStorageUnavailable(new Error("IndexedDB is blocked")));
    };
  });
}

function recreateHistoryStores(database: IDBDatabase) {
  for (const name of [
    commitStoreName,
    repositoryStoreName,
    topologyStoreName,
    recentTopologyStoreName,
  ])
    if (database.objectStoreNames.contains(name))
      database.deleteObjectStore(name);
  if (!database.objectStoreNames.contains(workingChangesStoreName))
    database.createObjectStore(workingChangesStoreName);
  database.createObjectStore(commitStoreName);
  database.createObjectStore(topologyStoreName);
  database.createObjectStore(recentTopologyStoreName);
  database
    .createObjectStore(repositoryStoreName, {
      keyPath: "id",
      autoIncrement: true,
    })
    .createIndex(identityIndexName, ["environmentId", "repositoryId"], {
      unique: true,
    });
}
