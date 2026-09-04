import { act } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader.contract";
import { useHistoryRefRefresh } from "#web/features/repository-workspace/use-history-ref-refresh";

it("refreshes sidebar refs after changed history completes without reacting to cached reads", async () => {
  const listeners = new Set<() => void>();
  let snapshot: RepositoryHistorySnapshot = {
    revision: 0,
    historyRevision: 0,
    status: "ready",
    synchronization: "complete",
  };
  const reader = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const refresh = vi.fn();
  function Workspace({ connected }: { readonly connected: boolean }) {
    useHistoryRefRefresh(reader, connected, refresh);
    return <div>Repository</div>;
  }
  const publish = async (change: Partial<RepositoryHistorySnapshot>) => {
    await act(async () => {
      snapshot = { ...snapshot, ...change };
      for (const listener of listeners) listener();
    });
  };
  const screen = await render(<Workspace connected />);
  await publish({ revision: 1 });
  await publish({
    revision: 2,
    historyRevision: 1,
    synchronization: "syncing",
  });
  expect(refresh).not.toHaveBeenCalled();
  await publish({ revision: 3, synchronization: "complete" });
  expect(refresh).toHaveBeenCalledOnce();
  await publish({ revision: 4 });
  expect(refresh).toHaveBeenCalledOnce();
  await screen.rerender(<Workspace connected={false} />);
  await publish({ revision: 5, historyRevision: 2 });
  expect(refresh).toHaveBeenCalledOnce();
});
