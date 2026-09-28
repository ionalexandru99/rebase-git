import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  type OperationStarted,
  type RepositoryOperation,
  RepositoryOperationsApi,
  type StartOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  CommitGraphFixture,
  history,
  historyReader,
} from "#tests-support/commit-graph-fixture.tsx";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  commitId,
  mainPath,
  repositoryOperation,
  repositoryRefs,
  repositoryScope,
  worktree,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const commits = history(4);

async function renderRevertGraph({
  operation = repositoryOperation({ branch: "main" }),
  start = async () => ({ outcome: "Committed", operation }),
}: {
  readonly operation?: RepositoryOperation;
  readonly start?: (input: StartOperation) => Promise<OperationStarted>;
} = {}) {
  const screen = await render(
    <div style={{ height: 520, width: 900 }}>
      <RepositoryScopeProvider scope={repositoryScope()}>
        <CommitGraphFixture
          reader={historyReader({ commits, status: "ready" })}
          repositoryName="rebase-test"
          roots={[{ name: "main", oid: "0".repeat(40), type: "branch" }]}
        />
      </RepositoryScopeProvider>
    </div>,
    {
      environment: {
        requests: fakeRequests(
          respond(RepositoryOperationsApi.read, async () => operation),
          respond(RepositoryRefsApi.read, async () =>
            repositoryRefs({ worktrees: [worktree(mainPath, "main")] }),
          ),
          respond(RepositoryOperationsApi.start, start),
        ),
      },
    },
  );
  const row = (index: number) =>
    screen.getByRole("row", {
      name: new RegExp(`^Commit ${index},`),
      includeHidden: true,
    });
  return { screen, row };
}

describe("revert commits from the graph", () => {
  it("numbers the selection newest first and reverts it in that order", async () => {
    const started: StartOperation[] = [];
    const { screen, row } = await renderRevertGraph({
      start: async (input) => {
        started.push(input);
        return { outcome: "Committed", operation: repositoryOperation() };
      },
    });
    await row(3).click();
    await userEvent.keyboard("{Control>}");
    await row(1).click();
    await userEvent.keyboard("{/Control}");

    await row(1).click({ button: "right" });
    const revert = screen.getByRole("menuitem", { name: /^Revert 2 commits/ });
    await expect.element(revert).toHaveTextContent("on main");
    await revert.hover();

    await expect.element(row(1)).toHaveTextContent("1Commit 1");
    await expect.element(row(3)).toHaveTextContent("2Commit 3");
    await revert.click();
    await expect.poll(() => started).toHaveLength(1);
    expect(started[0]?.expectedHead).toBe(commitId);
    expect(started[0]?.operation).toEqual({
      _tag: "Revert",
      commits: [commits[1]?.oid, commits[3]?.oid],
      commit: true,
    });
    await expect.element(row(1)).not.toHaveTextContent("1Commit 1");
  });

  it("names the operation that blocks a revert", async () => {
    const { screen, row } = await renderRevertGraph({
      operation: repositoryOperation({ kind: "rebase", phase: "conflicts" }),
    });

    await row(2).click({ button: "right" });

    const revert = screen.getByRole("menuitem", { name: /^Revert commit/ });
    await expect.element(revert).toHaveAttribute("aria-disabled", "true");
    await expect.element(revert).toHaveTextContent("Rebase in progress");
  });

  it("shows why Git did not revert", async () => {
    const { screen, row } = await renderRevertGraph({
      start: async () => {
        throw rejected({
          _tag: "OperationFailed",
          reason: "Empty",
          detail: "Nothing to revert. The changes are already undone.",
        });
      },
    });

    await row(2).click({ button: "right" });
    await screen
      .getByRole("menuitem", { name: "Revert without committing" })
      .click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Nothing to revert. The changes are already undone.");
  });
});
