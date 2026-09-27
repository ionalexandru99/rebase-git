import {
  type FetchFailed,
  type RepositoryFetchSetting,
  type RepositoryFetchStatus,
  RepositoryPullApi,
  RepositoryRefsApi,
} from "@rebase/contracts";
import { act } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { fetchStatus } from "#tests-support/fixtures";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  idleOperation,
  rejected,
  respond,
  unanswered,
} from "#tests-ui/runtime/fake-requests";
import { render, testChanges } from "#tests-ui/runtime/render";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import { RepositoryFetchSettings } from "#web/features/remote-sync/fetch-settings";
import { RemoteSync } from "#web/features/remote-sync/remote-sync";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope";

const scope = repositoryScope();
const fresh = fetchStatus();
const failed = fetchStatus({
  failure: { _tag: "FetchFailed", reason: "Failed" },
});

describe("repository fetch controls", () => {
  it("keeps an error dismissed while it lasts and announces a later failure", async () => {
    const f = await fixture(failed);
    const notification = page.getByRole("dialog", {
      name: "Fetch failed",
      exact: true,
    });
    await expect.element(notification).toBeVisible();
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await f.publish({ ...failed, defaultIntervalSeconds: 600 });
    await expect.element(notification).not.toBeInTheDocument();
    await f.publish(fresh);
    await f.publish(failed);
    await expect.element(notification).toBeVisible();
  });

  it("preserves focus when an error arrives and lets the keyboard dismiss it", async () => {
    const f = await fixture(fresh);
    const fetch = page.getByRole("button", { name: "Fetch", exact: true });
    await expect.element(fetch).toBeEnabled();
    fetch.element().focus();
    await f.publish(failed);
    await expect
      .element(page.getByRole("dialog", { name: "Fetch failed", exact: true }))
      .toBeVisible();
    await expect.element(fetch).toHaveFocus();
    await userEvent.keyboard("{F6}{Tab}{Tab}");
    const dismiss = page.getByRole("button", { name: "Dismiss notification" });
    await expect.element(dismiss).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(dismiss).not.toBeInTheDocument();
    await expect.element(fetch).toHaveFocus();
  });

  it("updates clean settings from other clients while preserving an edited interval", async () => {
    const f = await fixture({
      ...fresh,
      setting: { _tag: "Interval", seconds: 120 },
    });
    await f.publish({ ...fresh, defaultIntervalSeconds: 600 });
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
    await f.publish({
      ...fresh,
      setting: { _tag: "Disabled" },
      defaultIntervalSeconds: 900,
    });
    await expect.element(mode).toHaveValue("Interval");
    await expect.element(interval).toHaveValue(90);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => f.configure)
      .toHaveBeenLastCalledWith({ _tag: "Interval", seconds: 90 });
  });

  it("shows a failed fetch toast and clears it when fetching from the toolbar", async () => {
    const f = await fixture(fresh);
    f.fetch.mockRejectedValueOnce(unanswered);
    const fetch = page.getByRole("button", { name: "Fetch", exact: true });
    await fetch.click();
    await expect
      .element(page.getByRole("dialog", { name: "Fetch failed", exact: true }))
      .toBeVisible();
    await fetch.click();
    await expect
      .element(page.getByRole("dialog", { name: "Fetch failed", exact: true }))
      .not.toBeInTheDocument();
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it("disables duplicate fetches and shows background fetch failures", async () => {
    const f = await fixture(fresh);
    const finished = Promise.withResolvers<RepositoryFetchStatus>();
    f.fetch.mockReturnValueOnce(finished.promise);
    await page.getByRole("button", { name: "Fetch", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Fetching", exact: true }))
      .toBeDisabled();
    expect(f.fetch).toHaveBeenCalledOnce();
    finished.resolve(fresh);
    await expect
      .element(page.getByRole("button", { name: "Fetch", exact: true }))
      .toBeEnabled();
    await f.publish(failed);
    await expect
      .element(page.getByRole("dialog", { name: "Fetch failed", exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Fetch", exact: true }))
      .toBeEnabled();
  });

  it("saves custom, disabled, and inherited intervals", async () => {
    const f = await fixture(fresh);
    const mode = page.getByRole("combobox", { name: "Automatic fetch" });
    const save = page.getByRole("button", { name: "Save", exact: true });
    await mode.selectOptions("Interval");
    await page
      .getByRole("spinbutton", { name: "Interval in seconds" })
      .fill("120");
    await save.click();
    await expect
      .poll(() => f.configure)
      .toHaveBeenLastCalledWith({ _tag: "Interval", seconds: 120 });
    await mode.selectOptions("Disabled");
    await save.click();
    await expect
      .poll(() => f.configure)
      .toHaveBeenLastCalledWith({ _tag: "Disabled" });
    await mode.selectOptions("Inherit");
    await save.click();
    await expect
      .poll(() => f.configure)
      .toHaveBeenLastCalledWith({ _tag: "Inherit" });
  });

  it("keeps the edited interval available after a failed save", async () => {
    const f = await fixture(fresh);
    f.configure.mockRejectedValueOnce(unanswered);
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
        "The Environment did not answer. Check the connection and try again.",
      );
    await expect
      .element(page.getByRole("spinbutton", { name: "Interval in seconds" }))
      .toHaveValue(90);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  it("shows offline and disables fetching and its configuration", async () => {
    await fixture(fresh, { connected: false });
    await expect
      .element(page.getByRole("button", { name: "Fetch", exact: true }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("dialog", { name: "You're offline" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("combobox", { name: "Automatic fetch" }))
      .toBeDisabled();
    await expect
      .element(page.getByText("Reconnect to the server and try again."))
      .toBeVisible();
  });

  it("keeps settings read-only without repository write access", async () => {
    const f = await fixture(fresh, { canConfigure: false });
    await expect
      .element(page.getByRole("combobox", { name: "Automatic fetch" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Save", exact: true }))
      .toBeDisabled();
    expect(f.configure).not.toHaveBeenCalled();
  });
});

async function fixture(
  initial: RepositoryFetchStatus,
  {
    connected = true,
    canConfigure = true,
  }: { readonly connected?: boolean; readonly canConfigure?: boolean } = {},
) {
  let status = initial;
  const fetch = vi.fn(async (): Promise<RepositoryFetchStatus> => status);
  const configure = vi.fn(
    async (setting: RepositoryFetchSetting): Promise<RepositoryFetchStatus> => {
      status = { ...status, setting };
      return status;
    },
  );
  const changes = testChanges();
  await render(
    <NotificationsProvider>
      <RepositoryScopeProvider scope={{ ...scope, connected }}>
        <RemoteSync>{(actions) => actions}</RemoteSync>
      </RepositoryScopeProvider>
      <RepositoryFetchSettings
        repositoryId={scope.repositoryId}
        canConfigure={canConfigure}
      />
    </NotificationsProvider>,
    {
      queryClient: changes.queryClient,
      environment: {
        connected,
        requests: fakeRequests(
          idleOperation,
          respond(RepositoryRefsApi.read, () => {
            throw unanswered;
          }),
          respond(RepositoryPullApi.fetchStatus, async () => status),
          respond(RepositoryPullApi.fetch, async () => {
            const result = await fetch();
            if (result.failure !== undefined)
              throw rejected<FetchFailed>(result.failure);
            return result;
          }),
          respond(RepositoryPullApi.configureFetch, (input) =>
            configure(input.setting),
          ),
        ),
      },
    },
  );
  return {
    fetch,
    configure,
    publish: async (next: RepositoryFetchStatus) => {
      status = next;
      await act(async () => changes.publish([scope.repositoryId], "Refs"));
    },
  };
}
