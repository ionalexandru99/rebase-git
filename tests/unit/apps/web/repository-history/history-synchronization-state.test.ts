import { Scope } from "effect";
import { describe, expect, it } from "vitest";
import { RepositoryHistoryEpoch } from "#web/features/repository-history/reader/repository-history-epoch";
import type {
  ConnectedReader,
  HistorySynchronizationState,
} from "#web/features/repository-history/worker/history-worker.contract";
import {
  activeSynchronization,
  beginSynchronization,
  settleSynchronization,
} from "#web/features/repository-history/worker/synchronization-state";

describe("history synchronization ownership", () => {
  it("ignores completion from a canceled synchronization after ownership transfers", () => {
    const state = idleState();
    const first = reader();
    const second = reader();
    const canceled = beginSynchronization(state, first, "first");
    settleSynchronization(state, canceled, false);
    const replacement = beginSynchronization(state, second, "second");

    expect(settleSynchronization(state, canceled, true, "complete")).toBe(
      false,
    );
    expect(state.synchronization).toBe(replacement);
    expect(activeSynchronization(state, first, "first")).toBeUndefined();
    expect(activeSynchronization(state, second, "second")).toBe(replacement);
  });

  it.each(["idle", "complete", "stale"] as const)(
    "preserves cached history when synchronizing from %s fails",
    (status) => {
      const state = { ...idleState(), synchronization: { status } };
      const active = beginSynchronization(state, reader(), "current");
      active.storingCommits = true;

      settleSynchronization(state, active, true);

      expect(state.synchronization).toEqual({
        status: status === "idle" ? "idle" : "stale",
      });
      expect(state.reconciled).toBe(true);
    },
  );
});

function idleState(): HistorySynchronizationState {
  return {
    reconciled: false,
    needsReconciliation: false,
    synchronization: { status: "idle" },
  };
}

function reader(): ConnectedReader {
  const channel = new MessageChannel();
  channel.port1.close();
  channel.port2.close();
  return {
    closed: false,
    scope: Scope.makeUnsafe(),
    epoch: new RepositoryHistoryEpoch(),
    queries: new Map(),
    stopWatchingLease: () => undefined,
    connection: {
      _tag: "ConnectRepositoryHistoryReader",
      environmentId: "environment",
      logicalRepositoryId: "repository",
      repositoryId: "worktree",
      port: channel.port1,
      supportsFreshness: false,
    },
  };
}
