import {
  type EnvironmentRequestClient,
  environmentHttpRoutesClient,
} from "@rebase/environment-client";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
  mergeHistory,
  renderGraph,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";
import { render } from "#tests-ui/runtime/render";
import { RepositoryPull } from "#web/features/repository-pull/index";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";

describe("commit graph commands", () => {
  it("reveals a hidden result from cached search", async () => {
    const commits = mergeHistory();
    const reader = historyReader({ commits, status: "ready" });
    reader.search.mockResolvedValue({
      commits: commits.slice(3, 4),
      replicaComplete: true,
      synchronizedCommitCount: 6,
    });
    reader.ancestryRoute.mockResolvedValue({
      rootOid: historyOid(0),
      edges: [{ childOid: historyOid(0), parentOid: historyOid(2) }],
    });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    const search = screen.getByRole("searchbox", { name: "Search history" });
    await search.fill("Commit 3");
    await screen.getByRole("button", { name: /^Commit 3 Alex/ }).click();
    await expect
      .element(grid.getByRole("row", { name: /^Commit 3,/ }))
      .toHaveAttribute("aria-selected", "true");
    expect(reader.ancestryRoute).toHaveBeenCalledWith(
      [historyOid(0)],
      historyOid(3),
    );
  });

  it("fetches from the toolbar", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    const freshness = {
      revision: 0,
      fetching: false,
      stale: false,
      defaultIntervalSeconds: 300,
      setting: { _tag: "Inherit" as const },
    };
    reader.snapshot = { ...reader.snapshot, freshness };
    reader.fetch.mockResolvedValue(freshness);
    const screen = await renderGraph(reader, undefined, {
      commandEnvironment: {
        environmentId: "env",
        logicalRepositoryId: "logical",
        repositoryId: "repo",
        connected: true,
        capabilities: new Set(["repository.write"]),
        freshnessReady: true,
        operationState: "idle",
      },
    });
    const fetch = screen.getByRole("button", { name: "Fetch", exact: true });
    await fetch.click();
    await vi.waitFor(() => expect(reader.fetch).toHaveBeenCalledOnce());
    await expect.element(fetch).toBeEnabled();
  });

  it("pulls the active branch from the toolbar", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    const freshness = {
      revision: 0,
      fetching: false,
      stale: false,
      defaultIntervalSeconds: 300,
      setting: { _tag: "Inherit" as const },
    };
    reader.snapshot = { ...reader.snapshot, freshness };
    reader.fetch.mockResolvedValue(freshness);
    const pulled = vi.fn<(command: unknown) => void>();
    let finish = () => {};
    const requests: EnvironmentRequestClient = (routes) =>
      environmentHttpRoutesClient(routes, (_route, command) => {
        pulled(command);
        return Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        ).pipe(Effect.as({ outcome: "FastForwarded" } as never));
      });
    const screen = await render(
      <div style={{ height: 520, width: 900 }}>
        <RepositoryScopeProvider
          scope={{
            target: {
              repositoryId: "repo",
              worktreePath: "/repo",
              requests,
              changes: { subscribe: () => () => {} },
              runtime: ManagedRuntime.make(Layer.empty),
            },
            connected: true,
            writable: true,
          }}
        >
          <RepositoryPull.Provider reader={reader} incoming={3}>
            <CommitGraphFixture
              reader={reader}
              repositoryName="rebase-test"
              roots={[{ name: "main", oid: "0".repeat(40), type: "branch" }]}
              commandEnvironment={{
                environmentId: "env",
                logicalRepositoryId: "logical",
                repositoryId: "repo",
                activeBranch: "main",
                connected: true,
                capabilities: new Set(["repository.write"]),
                freshnessReady: true,
                operationState: "idle",
              }}
            />
          </RepositoryPull.Provider>
        </RepositoryScopeProvider>
      </div>,
    );
    await screen
      .getByRole("button", { name: "Pull 3 incoming commits" })
      .click();
    await vi.waitFor(() =>
      expect(pulled).toHaveBeenCalledWith({
        repositoryId: "repo",
        branch: "main",
      }),
    );
    await expect
      .element(screen.getByRole("button", { name: "Pulling" }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Fetch", exact: true }))
      .toBeDisabled();
    finish();
    await expect
      .element(screen.getByRole("button", { name: "Pull 3 incoming commits" }))
      .toBeEnabled();
  });

  it("selects the invoking commit and opens its menu from the keyboard", async () => {
    const commits = history(4);
    const reader = historyReader({ commits, status: "ready" });
    reader.getCommitSummaries.mockImplementation(async (oids) =>
      commits.filter(({ oid }) => oids.includes(oid)),
    );
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await grid.getByRole("row", { name: /^Commit 0,/ }).click();
    await grid
      .getByRole("row", { name: /^Commit 2,/ })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Copy commit subject" }).click();
    expect(copy).toHaveBeenLastCalledWith("Commit 2");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "false");
    await expect.element(grid).toHaveFocus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await screen.getByRole("menuitem", { name: "Copy commit SHA" }).click();
    expect(copy).toHaveBeenLastCalledWith(commits[2]?.oid);
    await userEvent.keyboard("{Control>}");
    await grid.getByRole("row", { name: /^Commit 0,/ }).click();
    await userEvent.keyboard("{/Control}");
    await grid
      .getByRole("row", { name: /^Commit 2,/ })
      .click({ button: "right" });
    await userEvent.keyboard("{Escape}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 2,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    grid
      .element()
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
    copy.mockRestore();
  });
});
