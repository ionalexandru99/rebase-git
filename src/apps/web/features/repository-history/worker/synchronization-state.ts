import type {
  ActiveHistorySynchronization,
  ConnectedReader,
  HistorySynchronizationState,
} from "#web/features/repository-history/worker/history-worker.contract";

export function activeSynchronization(
  replica: HistorySynchronizationState,
  owner: ConnectedReader,
  requestId: string,
) {
  const active = replica.synchronization;
  return active.status === "syncing" &&
    active.owner === owner &&
    active.requestId === requestId
    ? active
    : undefined;
}

export function beginSynchronization(
  replica: HistorySynchronizationState,
  owner: ConnectedReader,
  requestId: string,
): ActiveHistorySynchronization {
  const active: ActiveHistorySynchronization = {
    status: "syncing",
    owner,
    requestId,
    previous: replica.synchronization.status === "idle" ? "idle" : "stale",
    storingCommits: false,
  };
  replica.reconciled = true;
  replica.needsReconciliation = false;
  replica.synchronization = active;
  return active;
}

export function settleSynchronization(
  replica: HistorySynchronizationState,
  active: ActiveHistorySynchronization,
  reconciled: boolean,
  status: "complete" | "idle" | "stale" = active.previous,
) {
  if (replica.synchronization !== active) return false;
  replica.synchronization = { status };
  replica.reconciled = reconciled;
  return true;
}
