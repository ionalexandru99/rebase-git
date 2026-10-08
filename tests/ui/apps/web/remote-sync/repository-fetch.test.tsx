import { act } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  type RepositoryFetchSetting,
  type RepositoryFetchStatus,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  fakeRequests,
  idleOperation,
  respond,
  unanswered,
} from "#tests-support/fake-requests.ts";
import { fetchStatus, repositoryScope } from "#tests-support/fixtures.ts";
import { render, testChanges } from "#tests-support/render.tsx";
import { RepositoryFetchSettings } from "#web/features/remote-sync/fetch-settings.tsx";
import { RemoteSync } from "#web/features/remote-sync/remote-sync.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const scope = repositoryScope();
const fresh = fetchStatus();
const failed = fetchStatus({
  failure: { _tag: "FetchFailed", reason: "Failed" },
});

describe("repository fetch controls", () => {
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

  it("shows background fetch failures until a fetch succeeds", async () => {
    const f = await fixture(fresh);
    await f.publish(failed);
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Fetch failed");
    expect(page.getByText("Couldn't fetch").elements()).toHaveLength(0);
    await f.publish(fresh);
    await expect.element(page.getByRole("status")).not.toBeInTheDocument();
  });

  it("saves custom intervals with Save and other choices as soon as they change", async () => {
    const f = await fixture(fresh);
    const mode = page.getByRole("combobox", { name: "Automatic fetch" });
    await mode.selectOptions("Interval");
    await page
      .getByRole("spinbutton", { name: "Interval in seconds" })
      .fill("120");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => f.configure)
      .toHaveBeenLastCalledWith({ _tag: "Interval", seconds: 120 });
    await mode.selectOptions("Disabled");
    await expect
      .poll(() => f.configure)
      .toHaveBeenLastCalledWith({ _tag: "Disabled" });
    await mode.selectOptions("Inherit");
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
      .element(page.getByText("Couldn't save automatic fetch"))
      .toBeVisible();
    await expect
      .element(page.getByRole("spinbutton", { name: "Interval in seconds" }))
      .toHaveValue(90);
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => f.configure).toHaveBeenCalledTimes(2);
  });

  it("shows offline and disables the fetch configuration", async () => {
    await fixture(fresh, { connected: false });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("You're offline");
    await expect
      .element(page.getByRole("combobox", { name: "Automatic fetch" }))
      .toBeDisabled();
    await expect
      .element(page.getByText("Reconnect to change fetch settings."))
      .toBeVisible();
  });

  it("keeps settings read-only without repository write access", async () => {
    const f = await fixture(fresh, { canConfigure: false });
    await expect
      .element(page.getByRole("combobox", { name: "Automatic fetch" }))
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
  const configure = vi.fn(
    async (setting: RepositoryFetchSetting): Promise<RepositoryFetchStatus> => {
      status = { ...status, setting };
      return status;
    },
  );
  const changes = testChanges();
  await render(
    <>
      <RepositoryScopeProvider scope={{ ...scope, connected }}>
        <RemoteSync>{(actions) => actions}</RemoteSync>
      </RepositoryScopeProvider>
      <RepositoryFetchSettings
        repositoryId={scope.repositoryId}
        canConfigure={canConfigure}
      />
    </>,
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
          respond(RepositoryPullApi.configureFetch, (input) =>
            configure(input.setting),
          ),
        ),
      },
    },
  );
  return {
    configure,
    publish: async (next: RepositoryFetchStatus) => {
      status = next;
      await act(async () => changes.publish([scope.repositoryId], "Fetch"));
    },
  };
}
