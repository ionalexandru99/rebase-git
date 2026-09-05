import { act, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { emptyHistorySearchSnapshot } from "#web/features/repository-history/search/repository-history-search-model";
import {
  RepositoryHistorySearchFailure,
  type RepositoryHistorySearchModel,
  type RepositoryHistorySearchSnapshot,
} from "#web/features/repository-history/search/repository-history-search-model.contract";
import { RepositoryHistorySearchView } from "#web-ui/features/repository-history/search/components/repository-history-search-controls";

describe("history search model view", () => {
  it("subscribes only the search view and exposes typed failures through the same action contract", async () => {
    const listeners = new Set<() => void>();
    let snapshot: RepositoryHistorySearchSnapshot = emptyHistorySearchSnapshot;
    const publish = (next: RepositoryHistorySearchSnapshot) => {
      snapshot = next;
      for (const listener of listeners) listener();
    };
    const model: RepositoryHistorySearchModel = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      setText: vi.fn((text) => publish({ ...snapshot, text, loading: true })),
      retry: vi.fn(),
      navigate: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
    };
    const Graph = vi.fn(() => <div>Graph</div>);
    const screen = await render(
      <StrictMode>
        <Graph />
        <RepositoryHistorySearchView
          model={model}
          snapshot={{ historyRevision: 1, revision: 1, status: "ready" }}
        />
      </StrictMode>,
    );
    expect(listeners.size).toBe(1);
    const graphRenders = Graph.mock.calls.length;
    await page.getByRole("searchbox").fill("history");
    expect(model.setText).toHaveBeenCalledWith("history");
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Searching cached history");
    await act(() =>
      publish({
        ...snapshot,
        loading: false,
        error: new RepositoryHistorySearchFailure({
          operation: "search",
          cause: new Error("Worker closed"),
        }),
      }),
    );
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not search cached history.");
    await page.getByRole("button", { name: "Retry search" }).click();
    expect(model.retry).toHaveBeenCalledOnce();
    expect(Graph).toHaveBeenCalledTimes(graphRenders);
    await screen.unmount();
    expect(listeners.size).toBe(0);
  });
});
