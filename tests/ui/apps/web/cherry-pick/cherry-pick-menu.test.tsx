import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import type { RouteInput } from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type OperationStarted,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
  mergeHistory,
} from "#tests-support/commit-graph-fixture.tsx";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  changedFile,
  commitId,
  commitInspection,
  mainPath,
  repositoryChanges,
  repositoryOperation,
  repositoryRefs,
  repositoryScope,
  worktree,
} from "#tests-support/fixtures.ts";
import type { FakeRepositoryHistory } from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { useCherryPick } from "#web/features/cherry-pick/cherry-pick-menu.tsx";
import { NotificationsProvider } from "#web/features/notifications/notifications.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

type Start = RouteInput<typeof RepositoryOperationsApi.start>;

const short = (index: number) => historyOid(index).slice(0, 7);

async function fixture(
  commits: ReturnType<typeof history>,
  { staged = false } = {},
) {
  const start = vi.fn<(input: Start) => OperationStarted>(() => ({
    outcome: "Committed",
    operation: repositoryOperation(),
  }));
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryRefsApi.read, () =>
      repositoryRefs({ worktrees: [worktree(mainPath, "release")] }),
    ),
    respond(RepositoryChangesApi.read, () =>
      repositoryChanges({
        staged: staged ? [changedFile("src/staged.ts")] : [],
      }),
    ),
    respond(CommitInspectionApi.inspect, ({ parentOid }) =>
      commitInspection({
        files:
          parentOid === historyOid(1)
            ? [changedFile("src/retry.ts")]
            : [changedFile("src/a.ts"), changedFile("src/b.ts")],
      }),
    ),
    respond(RepositoryOperationsApi.start, (input) => start(input)),
  );
  const screen = await render(
    <NotificationsProvider>
      <WorkspacePanel.Provider scopeKey={crypto.randomUUID()}>
        <RepositoryScopeProvider scope={repositoryScope()}>
          <div style={{ height: 520, width: 900 }}>
            <CherryPickGraph
              history={historyReader({ commits, status: "ready" })}
            />
          </div>
        </RepositoryScopeProvider>
      </WorkspacePanel.Provider>
    </NotificationsProvider>,
    { environment: { requests } },
  );
  const row = (index: number) =>
    screen
      .getByRole("grid")
      .getByRole("row", { name: new RegExp(`^Commit ${index},`) });
  return { screen, start, row };
}

describe("cherry-pick from the graph menu", () => {
  it("previews the selection oldest first and runs it in that order", async () => {
    const { screen, start, row } = await fixture(history(4));
    await row(0).click();
    await userEvent.keyboard("{Control>}");
    await row(2).click();
    await userEvent.keyboard("{/Control}");

    await row(0).click({ button: "right" });

    await screen
      .getByRole("menuitem", { name: "Cherry-pick 2 commits" })
      .click();
    await expect
      .element(screen.getByRole("list", { name: "Cherry-pick order" }))
      .toHaveTextContent(`1${short(2)}Commit 22${short(0)}Commit 0`);
    await screen.getByRole("menuitem", { name: "Commit", exact: true }).click();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedHead: commitId,
        operation: {
          _tag: "CherryPick",
          commits: [historyOid(2), historyOid(0)],
          mainline: null,
          result: "commit",
        },
      }),
    );
  });

  it("keeps a selection with several merges from running with one parent choice", async () => {
    const { screen, start, row } = await fixture(mergeHistory());
    await screen
      .getByRole("button", { name: /^Expand merge/ })
      .first()
      .click();
    await row(0).click();
    await userEvent.keyboard("{Control>}");
    await row(2).click();
    await userEvent.keyboard("{/Control}");

    await row(0).click({ button: "right" });

    await expect
      .element(screen.getByRole("menuitem", { name: /^Cherry-pick 2 commits/ }))
      .toHaveTextContent("Several merges");
    await expect
      .element(screen.getByRole("menuitem", { name: /^Cherry-pick 2 commits/ }))
      .toHaveAttribute("aria-disabled", "true");
    expect(start).not.toHaveBeenCalled();
  });

  it("asks for the merge parent and keeps staging off while changes are staged", async () => {
    const { screen, start, row } = await fixture(mergeHistory(), {
      staged: true,
    });

    await row(0).click({ button: "right" });
    await screen
      .getByRole("menuitem", { name: "Cherry-pick", exact: true })
      .click();

    await expect
      .element(
        screen.getByRole("menuitem", { name: "Stage without committing" }),
      )
      .toHaveAttribute("aria-disabled", "true");
    await screen.getByRole("menuitem", { name: "Commit", exact: true }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: /Commit 1/ }))
      .toHaveTextContent("retry.ts");
    await screen.getByRole("menuitem", { name: /Commit 2/ }).click();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: {
          _tag: "CherryPick",
          commits: [historyOid(0)],
          mainline: 2,
          result: "commit",
        },
      }),
    );
  });
});

function CherryPickGraph({
  history,
}: {
  readonly history: FakeRepositoryHistory;
}) {
  const cherryPick = useCherryPick(history);
  return (
    <CommitGraphFixture
      reader={history}
      cherryPick={cherryPick}
      repositoryName="rebase-test"
      roots={[{ name: "main", oid: "0".repeat(40), type: "branch" }]}
    />
  );
}
