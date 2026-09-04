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
import { RepositoryHistoryFetchControls } from "#web-ui/features/repository-history/freshness/repository-history-fetch-controls";
import { RepositoryHistoryFreshnessStatus } from "#web-ui/features/repository-history/freshness/repository-history-freshness-status";

const fresh: RepositoryFreshness = {
  defaultIntervalSeconds: 300,
  fetching: false,
  stale: false,
  revision: 0,
  setting: { _tag: "Inherit" },
};
const ready: RepositoryHistorySnapshot = {
  revision: 0,
  status: "ready",
  freshness: fresh,
  synchronization: "complete",
};

describe("repository fetch controls", () => {
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
      name: "Repository fetch settings",
    });
    settings.element().focus();
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
    await page.getByRole("radio", { name: "Off", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(reader.configureFetch).toHaveBeenLastCalledWith({
      _tag: "Disabled",
    });
    await settings.click();
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
      name: "Repository fetch settings",
    });
    await settings.click();
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
    await render(<Controls reader={reader} snapshot={offline} />);
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
    await page
      .getByRole("button", { name: "Repository fetch settings" })
      .click();
    await expect
      .element(page.getByRole("button", { name: "Save", exact: true }))
      .toBeDisabled();
  });
});

function Controls({
  reader,
  snapshot,
}: {
  readonly reader: RepositoryHistoryReader;
  readonly snapshot: RepositoryHistorySnapshot;
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
      <RepositoryHistoryFetchControls
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

function createReader() {
  return {
    close: vi.fn(),
    fetch: vi.fn<RepositoryHistoryReader["fetch"]>(async () => fresh),
    configureFetch: vi.fn<RepositoryHistoryReader["configureFetch"]>(
      async (setting) => ({ ...fresh, setting }),
    ),
    getSnapshot: () => ready,
    getRefTargets: async () => [],
    getCommitSummaries: async () => [],
    read: async () => [],
    subscribe: () => () => {},
  } satisfies RepositoryHistoryReader;
}
