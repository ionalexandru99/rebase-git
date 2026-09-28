import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type OperationFailure,
  RepositoryOperationsApi,
  type StartOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  CommitGraphFixture,
  historyReader,
} from "#tests-support/commit-graph-fixture.tsx";
import {
  fakeRequests,
  idleOperation,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  changedFile,
  mainPath,
  repositoryChanges,
  repositoryOperation,
  repositoryRefs,
  repositoryScope,
  upstream,
} from "#tests-support/fixtures.ts";
import {
  type FakeRepositoryHistory,
  historyCommit,
  historyOid,
} from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { NotificationsProvider } from "#web/features/notifications/notifications.tsx";
import { useRebaseActions } from "#web/features/rebase/rebase-actions.ts";
import type { RebasePlanTarget } from "#web/features/rebase/rebase-plan.ts";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const base = historyOid(1);
const main = historyOid(2);
const pushed = historyOid(3);
const topic = historyOid(4);

describe("rebase from the graph menu", () => {
  it("rebases the checked-out branch onto the row's branch and stashes the changed files it named", async () => {
    const f = await fixture();
    await f.openMenu("Main one");
    const item = page.getByRole("menuitem", { name: /^Rebase onto main/ });
    await expect
      .element(item)
      .toHaveTextContent(
        "Rebase onto main2 commits · 1 pushed · stashes 1 file",
      );
    await item.click();
    await expect
      .poll(() => f.started)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          expectedHead: topic,
          operation: {
            _tag: "Rebase",
            onto: { ref: "main", commit: main },
            stash: true,
          },
        }),
      );
  });

  it("says why a commit the branch already contains is not a target", async () => {
    const f = await fixture();
    await f.openMenu("Topic one");
    await expect
      .element(
        page.getByRole("menuitem", { name: /^Rebase onto origin\/topic/ }),
      )
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(
        page.getByRole("menuitem", { name: /^Rebase onto origin\/topic/ }),
      )
      .toHaveTextContent("Already on it");
  });

  it("opens an interactive plan onto another branch or from a commit of the branch", async () => {
    const f = await fixture();
    await f.openMenu("Main one");
    const onto = page.getByRole("menuitem", {
      name: /^Interactive rebase onto main/,
    });
    await expect.element(onto).toHaveTextContent("2 commits");
    await onto.click();
    expect(f.planned).toHaveBeenLastCalledWith({
      ref: "main",
      commit: main,
      from: false,
    });
    await f.openMenu("Topic two");
    const from = page.getByRole("menuitem", {
      name: /^Interactive rebase from here/,
    });
    await expect.element(from).toHaveTextContent("1 commit");
    await from.click();
    expect(f.planned).toHaveBeenLastCalledWith({
      ref: null,
      commit: topic,
      from: true,
    });
  });

  it("shows Git's reason when the rebase is refused", async () => {
    const f = await fixture({
      _tag: "OperationFailed",
      reason: "Stale",
      detail: "topic moved. Try the rebase again.",
    });
    await f.openMenu("Main one");
    await page.getByRole("menuitem", { name: /^Rebase onto main/ }).click();
    await expect
      .element(page.getByText("topic moved. Try the rebase again."))
      .toBeVisible();
  });
});

async function fixture(failure?: OperationFailure) {
  const started = vi.fn<(command: StartOperation) => void>();
  const planned = vi.fn<(target: RebasePlanTarget) => void>();
  const reader = historyReader({
    commits: [
      historyCommit(topic, [pushed], 4, "Topic two"),
      historyCommit(pushed, [base], 3, "Topic one"),
      historyCommit(main, [base], 2, "Main one"),
      historyCommit(base, [], 1, "Base"),
    ],
    status: "ready",
  });
  reader.publish({
    refTargets: [
      { name: "topic", oid: topic, type: "branch" },
      { name: "main", oid: main, type: "branch" },
      { name: "origin/topic", oid: pushed, type: "remote-branch" },
    ],
  });
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryRefsApi.read, async () =>
      repositoryRefs({
        branches: [
          {
            name: "topic",
            target: topic,
            upstream: upstream("origin/topic", { ahead: 1 }),
            worktreePath: mainPath,
          },
          { name: "main", target: main },
        ],
        remoteBranches: [{ name: "topic", remote: "origin", target: pushed }],
        worktrees: [
          {
            head: { branch: "topic", commit: topic },
            main: true,
            path: mainPath,
          },
        ],
      }),
    ),
    respond(RepositoryChangesApi.read, async () =>
      repositoryChanges({
        unstaged: [changedFile("retry.ts"), changedFile("notes.txt", "?")],
        staged: [changedFile("retry.ts")],
      }),
    ),
    respond(RepositoryOperationsApi.start, async (command) => {
      started(command);
      if (failure !== undefined) throw rejected(failure);
      return { outcome: "Rebased" as const, operation: repositoryOperation() };
    }),
  );
  const screen = await render(
    <NotificationsProvider>
      <div style={{ height: 520, width: 900 }}>
        <RepositoryScopeProvider scope={repositoryScope()}>
          <RebaseGraph history={reader} openPlan={planned} />
        </RepositoryScopeProvider>
      </div>
    </NotificationsProvider>,
    { environment: { requests } },
  );
  return {
    started,
    planned,
    openMenu: (subject: string) =>
      screen
        .getByRole("grid")
        .getByRole("row", { name: new RegExp(`^${subject},`) })
        .click({ button: "right" }),
  };
}

function RebaseGraph({
  history,
  openPlan,
}: {
  readonly history: FakeRepositoryHistory;
  readonly openPlan: (target: RebasePlanTarget) => void;
}) {
  const rebase = useRebaseActions(history, openPlan);
  return (
    <CommitGraphFixture
      reader={history}
      rebase={rebase}
      repositoryName="rebase-test"
      roots={[
        { name: "topic", oid: topic, type: "branch" },
        { name: "main", oid: main, type: "branch" },
      ]}
    />
  );
}
