import type { RepositoryHistoryStorageDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";

export interface HistoryStorageRequest {
  readonly _tag: "HistoryStorageRequest";
  readonly operation: "inspect" | "clear";
  readonly port: MessagePort;
}

export type HistoryStorageResponse =
  | {
      readonly _tag: "HistoryStorageResult";
      readonly diagnostics: RepositoryHistoryStorageDiagnostics;
    }
  | { readonly _tag: "HistoryStorageFailed" | "WorkerFailed" };
