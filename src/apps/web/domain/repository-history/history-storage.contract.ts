export interface RepositoryHistoryCacheDiagnostics {
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly estimatedBytes: number;
  readonly commitCount: number;
  readonly lastOpenedAt: number | undefined;
  readonly open: boolean;
  readonly state: "empty" | "partial" | "complete" | "incompatible";
}

export interface RepositoryHistoryStorageDiagnostics {
  readonly caches: readonly RepositoryHistoryCacheDiagnostics[];
  readonly persistent: boolean;
  readonly usageBytes?: number;
  readonly quotaBytes?: number;
}

export type RepositoryHistoryCacheAction =
  | "clear"
  | "rebuild"
  | "remove"
  | "clear-all";

export interface RepositoryHistoryCacheManagement {
  readonly getCacheDiagnostics: () => Promise<RepositoryHistoryStorageDiagnostics>;
  readonly manageCache: (action: RepositoryHistoryCacheAction) => Promise<void>;
}
