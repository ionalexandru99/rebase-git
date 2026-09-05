import type { RepositoryFreshness } from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useRepositoryHistoryFetch } from "#web/features/repository-history/freshness/use-repository-history-fetch";
import {
  RepositoryHistoryOffline,
  type RepositoryHistoryReader,
  RepositoryHistoryRejected,
  type RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";
import { CommitGraphToolbar } from "#web-ui/features/commit-graph/commit-graph-toolbar";
import { RepositoryHistoryFreshnessStatus } from "#web-ui/features/repository-history/freshness/repository-history-freshness-status";

const fresh: RepositoryFreshness = {
  defaultIntervalSeconds: 300,
  fetching: false,
  stale: false,
  revision: 0,
  setting: { _tag: "Inherit" },
};
const ready: RepositoryHistorySnapshot = {
  historyRevision: 0,
  revision: 0,
  status: "ready",
  freshness: fresh,
  synchronization: "complete",
};

describe("repository fetch controls", () => {
  it("updates clean settings from other clients while preserving an edited interval", async () => {
    const reader = createReader();
    const screen = await render(
      <Controls
        reader={reader}
        snapshot={{
          ...ready,
          freshness: { ...fresh, setting: { _tag: "Interval", seconds: 120 } },
        }}
      />,
    );
    await openFetchSettings();
    await screen.rerender(
      <Controls
        reader={reader}
        snapshot={{
          ...ready,
          freshness: { ...fresh, defaultIntervalSeconds: 600 },
        }}
      />,
    );
    await expect
      .element(
        page.getByRole("radio", { name: "Use server default (10 minutes)" }),
      )
      .toBeChecked();
    await page.getByRole("radio", { name: "Custom interval" }).click();
    const interval = page.getByRole("spinbutton", {
      name: "Interval in seconds",
    });
    await expect.element(interval).toHaveValue(600);
    await interval.fill("90");
    await screen.rerender(
      <Controls
        reader={reader}
        snapshot={{
          ...ready,
          freshness: {
            ...fresh,
            setting: { _tag: "Disabled" },
            defaultIntervalSeconds: 900,
          },
        }}
      />,
    );
    await expect
      .element(page.getByRole("radio", { name: "Custom interval" }))
      .toBeChecked();
    await expect.element(interval).toHaveValue(90);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(reader.configureFetch).toHaveBeenLastCalledWith({
      _tag: "Interval",
      seconds: 90,
    });
  });

  it("uses the shared fetch handler for the toolbar and retry with configured shortcut metadata", async () => {
    const reader = createReader();
    reader.fetch.mockRejectedValueOnce(new RepositoryHistoryOffline());
    await render(<Controls reader={reader} snapshot={ready} />);
    const fetch = page.getByRole("button", { name: "Fetch", exact: true });
    await expect
      .element(fetch)
      .toHaveAttribute("aria-keyshortcuts", "Control+Shift+F");
    await expect
      .element(fetch)
      .toHaveAttribute("title", "Fetch (Ctrl+Shift+F)");
    await fetch.click();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Reconnect to the server and try again.");
    expect(reader.fetch).toHaveBeenCalledOnce();
    await page.getByRole("button", { name: "Retry fetch" }).click();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Automatic fetch every 5 minutes");
    expect(reader.fetch).toHaveBeenCalledTimes(2);
  });

  it("disables duplicate fetches while keeping cached-history status nonblocking", async () => {
    const reader = createReader();
    let complete: ((state: RepositoryFreshness) => void) | undefined;
    reader.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const screen = await render(<Controls reader={reader} snapshot={ready} />);
    await page.getByRole("button", { name: "Fetch", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Fetching", exact: true }))
      .toBeDisabled();
    expect(reader.fetch).toHaveBeenCalledOnce();
    complete?.(fresh);
    await expect
      .element(page.getByRole("button", { name: "Fetch", exact: true }))
      .toBeEnabled();
    await screen.rerender(
      <Controls
        reader={reader}
        snapshot={{
          ...ready,
          freshness: {
            ...fresh,
            stale: true,
            failure: { _tag: "FetchFailed", reason: "Failed" },
          },
        }}
      />,
    );
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Fetch failed. Cached history is available.");
    await expect
      .element(page.getByRole("button", { name: "Retry fetch" }))
      .toBeEnabled();
  });

  it("opens settings from the keyboard and saves custom, disabled and inherited intervals", async () => {
    const reader = createReader();
    await render(<Controls reader={reader} snapshot={ready} />);
    const settings = page.getByRole("button", {
      name: "History options",
    });
    settings.element().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    await page.getByRole("radio", { name: "Custom interval" }).click();
    await page
      .getByRole("spinbutton", { name: "Interval in seconds" })
      .fill("120");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(reader.configureFetch).toHaveBeenLastCalledWith({
      _tag: "Interval",
      seconds: 120,
    });
    await expect
      .element(page.getByRole("radio", { name: "Custom interval" }))
      .not.toBeInTheDocument();
    await expect.element(settings).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    await page.getByRole("radio", { name: "Off", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(reader.configureFetch).toHaveBeenLastCalledWith({
      _tag: "Disabled",
    });
    await openFetchSettings();
    await page
      .getByRole("radio", { name: "Use server default (5 minutes)" })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(reader.configureFetch).toHaveBeenLastCalledWith({ _tag: "Inherit" });
  });

  it("keeps settings open after a save fails and closes them with Escape", async () => {
    const reader = createReader();
    reader.configureFetch.mockRejectedValueOnce(
      new RepositoryHistoryRejected({
        failure: { _tag: "AuthorizationDenied" },
      }),
    );
    await render(<Controls reader={reader} snapshot={ready} />);
    const settings = page.getByRole("button", {
      name: "History options",
    });
    await openFetchSettings();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(
        "You do not have permission to change this repository.",
      );
    await expect
      .element(page.getByRole("button", { name: "Save", exact: true }))
      .toBeEnabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(settings).toHaveFocus();
  });

  it("shows offline cached history and keeps no-change reconciliations quiet", async () => {
    const reader = createReader();
    const offline = {
      ...ready,
      freshnessError: new RepositoryHistoryOffline(),
      synchronization: "syncing" as const,
      storingCommits: false,
      shallowOids: ["a".repeat(40)],
    };
    const screen = await render(
      <Controls reader={reader} snapshot={offline} />,
    );
    await expect
      .element(page.getByRole("button", { name: "Fetch", exact: true }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Offline. Cached history is available.");
    await expect
      .element(page.getByText("Shallow history", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Syncing", { exact: true }))
      .not.toBeInTheDocument();
    await openFetchSettings();
    await expect
      .element(page.getByRole("button", { name: "Save", exact: true }))
      .toBeDisabled();
    await expect
      .element(page.getByText("Reconnect to the server and try again."))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "Connect with repository write access to change fetch settings.",
        ),
      )
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await screen.rerender(
      <Controls
        reader={reader}
        snapshot={{ ...offline, synchronizedCommitCount: 0 }}
      />,
    );
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Offline. No cached history is available.");
  });

  it("keeps settings read-only without repository write access", async () => {
    const reader = createReader();
    await render(
      <Controls reader={reader} snapshot={ready} canConfigure={false} />,
    );
    await openFetchSettings();
    await expect
      .element(page.getByRole("radio", { name: "Custom interval" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Save", exact: true }))
      .toBeDisabled();
    expect(reader.configureFetch).not.toHaveBeenCalled();
  });
});

function Controls({
  reader,
  snapshot,
  canConfigure = true,
}: {
  readonly reader: RepositoryHistoryReader;
  readonly snapshot: RepositoryHistorySnapshot;
  readonly canConfigure?: boolean;
}) {
  const fetch = useRepositoryHistoryFetch(reader, snapshot);
  const fetchAction = {
    execute: fetch.execute,
    disabled: snapshot.freshnessError !== undefined,
    shortcut: "Ctrl+Shift+F",
    ariaKeyShortcuts: "Control+Shift+F",
  };
  return (
    <>
      <CommitGraphToolbar
        repositoryName="Rebase"
        order="topological"
        onOrderChange={() => {}}
        searchRef={null}
        onNavigate={async () => {}}
        searchBindings={{}}
        offline={snapshot.freshnessError !== undefined}
        canConfigure={canConfigure}
        cache={undefined}
        fetchAction={fetchAction}
        fetching={fetch.fetching}
        reader={reader}
        snapshot={snapshot}
      />
      <RepositoryHistoryFreshnessStatus
        error={fetch.error}
        fetchAction={fetchAction}
        fetching={fetch.fetching}
        snapshot={snapshot}
      />
    </>
  );
}

async function openFetchSettings() {
  await page.getByRole("button", { name: "History options" }).click();
  await page.getByRole("menuitem", { name: "Fetch settings" }).click();
}

function createReader() {
  return {
    getCacheDiagnostics: async () => ({ caches: [], persistent: false }),
    manageCache: async () => {},
    search: async () => ({
      commits: [],
      replicaComplete: true,
      synchronizedCommitCount: 0,
    }),
    ancestryRoute: async () => undefined,
    locate: async () => undefined,
    locateMany: async () => [],
    close: vi.fn(),
    fetch: vi.fn<RepositoryHistoryReader["fetch"]>(async () => fresh),
    configureFetch: vi.fn<RepositoryHistoryReader["configureFetch"]>(
      async (setting) => ({
        ...fresh,
        setting,
      }),
    ),
    getSnapshot: () => ready,
    getRefTargets: async () => [],
    getCommitSummaries: async () => [],
    read: async () => [],
    subscribe: () => () => {},
  } satisfies RepositoryHistoryReader;
}
