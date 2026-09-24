import type { PullHttpFailure, RepositoryFreshness } from "@rebase/contracts";
import {
  EnvironmentHttpRejected,
  type EnvironmentRequestClient,
  environmentHttpRoutesClient,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import {
  ErrorNotification,
  NotificationsProvider,
} from "#web/features/notifications/index";
import { useRepositoryPull } from "#web/features/repository-pull/index";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const freshness: RepositoryFreshness = {
  revision: 1,
  fetching: false,
  stale: false,
  defaultIntervalSeconds: 300,
  setting: { _tag: "Inherit" },
};

describe("repository pull", () => {
  it("fetches before fast-forwarding the branch", async () => {
    const f = await fixture();
    await f.pull();
    await vi.waitFor(() =>
      expect(f.requested).toHaveBeenCalledWith({
        repositoryId,
        branch: "main",
      }),
    );
    expect(f.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      f.requested.mock.invocationCallOrder[0] ?? 0,
    );
    await expect
      .element(page.getByRole("button", { name: "Pull" }))
      .toBeEnabled();
    await expect.element(page.getByRole("status")).not.toBeInTheDocument();
  });

  it("does not pull when the fetch fails", async () => {
    const f = await fixture({
      fetched: {
        ...freshness,
        failure: { _tag: "FetchFailed", reason: "Failed" },
      },
    });
    await f.pull();
    await expect
      .element(page.getByRole("button", { name: "Pull" }))
      .toBeEnabled();
    expect(f.requested).not.toHaveBeenCalled();
  });

  it.each<[PullHttpFailure, string]>([
    [
      { _tag: "PullDiverged", upstream: "origin/main", ahead: 1, behind: 2 },
      "Can't fast-forward main. It has 1 commit that origin/main doesn't, and origin/main has 2 commits it doesn't. Merge or rebase to combine them.",
    ],
    [
      { _tag: "PullWouldOverwrite", paths: ["src/app.ts", "README.md"] },
      "Pull stopped. Nothing changed. Your edits to src/app.ts and 1 other file overlap incoming changes. Commit or discard them, then pull again.",
    ],
    [
      { _tag: "UpstreamMissing", upstream: "origin/main" },
      "origin/main no longer exists on the remote.",
    ],
    [
      { _tag: "PullUncertain" },
      "The pull may not have finished. Check main before pulling again.",
    ],
  ])("explains a rejected pull: %j", async (failure, message) => {
    const f = await fixture({ failure });
    await f.pull();
    await expect.element(page.getByText(message)).toBeVisible();
  });
});

async function fixture({
  fetched = freshness,
  failure,
}: {
  readonly fetched?: RepositoryFreshness;
  readonly failure?: PullHttpFailure;
} = {}) {
  const fetch = vi.fn(async () => fetched);
  const requested = vi.fn();
  const requests: EnvironmentRequestClient = (routes, errors) =>
    environmentHttpRoutesClient(routes, (_route, command) => {
      requested(command);
      return failure === undefined
        ? Effect.succeed({ outcome: "FastForwarded" })
        : Effect.fail(
            errors.response(
              new EnvironmentHttpRejected({ failure, status: 409 }),
            ),
          );
    });
  await render(
    <NotificationsProvider>
      <PullHarness requests={requests} reader={{ fetch }} />
    </NotificationsProvider>,
  );
  return {
    fetch,
    requested,
    pull: () => page.getByRole("button", { name: "Pull" }).click(),
  };
}

function PullHarness({
  requests,
  reader,
}: {
  readonly requests: EnvironmentRequestClient;
  readonly reader: { readonly fetch: () => Promise<RepositoryFreshness> };
}) {
  const pull = useRepositoryPull(requests, repositoryId, reader);
  return (
    <>
      <button
        disabled={pull.pulling !== undefined}
        onClick={() => pull.pull?.("main")}
        type="button"
      >
        {pull.pulling === undefined ? "Pull" : "Pulling"}
      </button>
      {pull.error === undefined ? null : (
        <ErrorNotification key={pull.error.id} message={pull.error.message} />
      )}
    </>
  );
}
