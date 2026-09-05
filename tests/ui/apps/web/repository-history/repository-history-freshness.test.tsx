import type { RepositoryFreshness } from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useRepositoryHistoryFetch } from "#web/features/repository-history/freshness/hooks/use-repository-history-fetch";
import { describeRepositoryFetchError } from "#web/features/repository-history/freshness/repository-fetch-error";
import {
  RepositoryHistoryOffline,
  type RepositoryHistoryReader,
  RepositoryHistoryRejected,
  type RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";
import { CommitGraphToolbar } from "#web-ui/features/commit-graph/components/commit-graph-toolbar";
import { RepositoryFetchSettings } from "#web-ui/features/repository-history/freshness/components/repository-fetch-settings";
import { RepositoryHistoryFreshnessStatus } from "#web-ui/features/repository-history/freshness/components/repository-history-freshness-status";

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
    await screen.rerender(
      <Controls
        reader={reader}
        snapshot={{
          ...ready,
          freshness: { ...fresh, defaultIntervalSeconds: 600 },
        }}
      />,
    );
    const mode = page.getByRole("combobox", { name: "Automatic fetch" });
    await expect
      .element(mode)
      .toHaveAccessibleDescription(
        "Shared by clients connected to this repository.",
      );
    await expect.element(mode).toHaveValue("Inherit");
    await mode.selectOptions("Interval");
    const interval = page.getByRole("spinbutton", {
      name: "Interval in seconds",
    });
    await expect.element(interval).toHaveValue(600);
    await expect
      .element(interval)
      .toHaveAccessibleDescription("Fetch every 1 to 86,400 seconds.");
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
    await expect.element(mode).toHaveValue("Interval");
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
    await fetch.click();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Reconnect to the server and try again.");
    expect(reader.fetch).toHaveBeenCalledOnce();
    await page.getByRole("button", { name: "Retry fetch" }).click();
    await expect
      .element(page.getByRole("button", { name: "Retry fetch" }))
      .not.toBeInTheDocument();
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

  it("saves custom, disabled, and inherited intervals", async () => {
    const reader = createReader();
    await render(<Controls reader={reader} snapshot={ready} />);
    const mode = page.getByRole("combobox", { name: "Automatic fetch" });
    await mode.selectOptions("Interval");
    await page
      .getByRole("spinbutton", { name: "Interval in seconds" })
      .fill("120");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(reader.configureFetch).toHaveBeenLastCalledWith({
      _tag: "Interval",
      seconds: 120,
    });
    await mode.selectOptions("Disabled");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(reader.configureFetch).toHaveBeenLastCalledWith({
      _tag: "Disabled",
    });
    await mode.selectOptions("Inherit");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(reader.configureFetch).toHaveBeenLastCalledWith({ _tag: "Inherit" });
  });

  it("keeps the edited interval available after a failed save", async () => {
    const reader = createReader();
    reader.configureFetch.mockRejectedValueOnce(
      new RepositoryHistoryRejected({
        failure: { _tag: "AuthorizationDenied" },
      }),
    );
    await render(<Controls reader={reader} snapshot={ready} />);
    await page
      .getByRole("combobox", { name: "Automatic fetch" })
      .selectOptions("Interval");
    await page
      .getByRole("spinbutton", { name: "Interval in seconds" })
      .fill("90");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(
        "You do not have permission to change this repository.",
      );
    await expect
      .element(page.getByRole("spinbutton", { name: "Interval in seconds" }))
      .toHaveValue(90);
    await expect
      .element(page.getByRole("button", { name: "Save", exact: true }))
      .toBeEnabled();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  it("shows offline history and disables fetch configuration", async () => {
    const reader = createReader();
    await render(
      <Controls
        reader={reader}
        snapshot={{
          ...ready,
          freshnessError: new RepositoryHistoryOffline(),
          synchronization: "syncing",
          storingCommits: false,
          shallowOids: ["a".repeat(40)],
        }}
      />,
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
      .element(page.getByRole("combobox", { name: "Automatic fetch" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Save", exact: true }))
      .toBeDisabled();
    await expect
      .element(
        page.getByText("Reconnect to the server and try again.", {
          exact: true,
        }),
      )
      .toBeVisible();
  });

  it("keeps settings read-only without repository write access", async () => {
    const reader = createReader();
    await render(
      <Controls reader={reader} snapshot={ready} canConfigure={false} />,
    );
    await expect
      .element(page.getByRole("combobox", { name: "Automatic fetch" }))
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
  readonly reader: ReturnType<typeof createReader>;
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
      <CommitGraphToolbar.Frame>
        <CommitGraphToolbar.Title repositoryName="Rebase" />
        <CommitGraphToolbar.Fetch
          fetchAction={fetchAction}
          fetching={fetch.fetching}
        />
      </CommitGraphToolbar.Frame>
      <RepositoryFetchSettings
        reader={reader}
        setting={snapshot.freshness?.setting ?? { _tag: "Inherit" }}
        defaultIntervalSeconds={
          snapshot.freshness?.defaultIntervalSeconds ?? 300
        }
        disabled={!canConfigure || snapshot.freshnessError !== undefined}
        disabledReason={
          snapshot.freshnessError === undefined
            ? "Connect with repository write access to change fetch settings."
            : describeRepositoryFetchError(snapshot.freshnessError)
        }
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
    fetch: vi.fn<RepositoryHistoryReader["fetch"]>(async () => fresh),
    configureFetch: vi.fn<RepositoryHistoryReader["configureFetch"]>(
      async (setting) => ({ ...fresh, setting }),
    ),
  };
}
