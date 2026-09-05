import type {
  StoredCommit,
  StoredRepository,
} from "#web/persistence/repository-history/repository-history-database.contract";

export interface RepositoryHistoryReadTransaction {
  readonly completed: Promise<void>;
  readonly readRepository: (
    key: string,
  ) => Promise<StoredRepository | undefined>;
  readonly readCommit: (key: string) => Promise<StoredCommit | undefined>;
}

export interface RepositoryHistoryRepositoryTransaction {
  readonly completed: Promise<void>;
  readonly readRepository: (
    key: string,
  ) => Promise<StoredRepository | undefined>;
  readonly storeRepository: (record: StoredRepository) => void;
}

export interface RepositoryHistoryWriteTransaction
  extends RepositoryHistoryReadTransaction,
    RepositoryHistoryRepositoryTransaction {
  readonly storeCommit: (record: StoredCommit) => void;
  readonly readCommitChunk: (
    key: string,
    after: string | undefined,
    limit: number,
  ) => Promise<StoredCommit[]>;
  readonly countCommits: (key: string) => Promise<number>;
  readonly deleteCommit: (key: string) => void;
  readonly deleteRepositoryCommits: (key: string) => void;
  readonly deleteRepository: (key: string) => void;
}

export interface RepositoryHistorySearchRecords {
  readonly readRepository: () => Promise<StoredRepository | undefined>;
  readonly readChunk: (
    after: string | undefined,
    limit: number,
  ) => Promise<StoredCommit[]>;
}
