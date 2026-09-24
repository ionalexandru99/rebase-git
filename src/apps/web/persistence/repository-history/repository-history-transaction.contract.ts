import type {
  NewStoredRepository,
  StoredCommit,
  StoredRepository,
} from "#web/persistence/repository-history/repository-history-database.contract";

export interface RepositoryHistoryReadTransaction {
  readonly completed: Promise<void>;
  readonly readRepository: (
    environmentId: string,
    repositoryId: string,
  ) => Promise<StoredRepository | undefined>;
  readonly readCommit: (
    repository: number,
    oid: string,
  ) => Promise<StoredCommit | undefined>;
}

export interface RepositoryHistoryRepositoryTransaction {
  readonly completed: Promise<void>;
  readonly readRepository: (
    environmentId: string,
    repositoryId: string,
  ) => Promise<StoredRepository | undefined>;
  readonly storeRepository: (
    record: StoredRepository | NewStoredRepository,
  ) => Promise<number>;
}

export interface RepositoryHistoryWriteTransaction
  extends RepositoryHistoryReadTransaction,
    RepositoryHistoryRepositoryTransaction {
  readonly storeCommit: (repository: number, record: StoredCommit) => void;
  readonly deleteRepositoryCommits: (repository: number) => void;
  readonly deleteRepository: (repository: number) => void;
}

export interface RepositoryHistorySearchRecords {
  readonly readRepository: () => Promise<StoredRepository | undefined>;
  readonly readChunk: (
    repository: number,
    after: string | undefined,
    limit: number,
  ) => Promise<StoredCommit[]>;
}
