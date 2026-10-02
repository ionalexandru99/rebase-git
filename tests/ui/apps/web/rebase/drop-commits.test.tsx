import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type RepositoryOperation,
  RepositoryOperationsApi,
  type StartOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type RepositoryHead,
  RepositoryRefsApi,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { CommitGraphFixture } from "#tests-support/commit-graph-fixture.tsx";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  conflictedRebase,
  mainPath,
  repositoryChanges,
  repositoryOperation,
  repositoryRefs,
  repositoryScope,
  upstream,
} from "#tests-support/fixtures.ts";
import {
  historyCommit as commit,
  type FakeRepositoryHistory,
  fakeRepositoryHistory,
  historyOid,
} from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import {
  DropConfirmation,
  useDropCommits,
} from "#web/features/rebase/drop-commits.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const typo = historyOid(4);
const retry = historyOid(3);
const debug = historyOid(2);
const base = historyOid(1);
const commits = [
  commit(typo, [retry], 4, "Fix typo"),
  commit(retry, [debug], 3, "Add retry"),
  commit(debug, [base], 2, "Debug logging"),
  commit(base, [], 1, "Base"),
];

describe("drop commits from the graph", () => {
  it("drops commits that are not next to each other after listing them", async () => {
    const f = await renderDrop();
    await f.row("Fix typo").click();
    await userEvent.keyboard("{Control>}");
    await f.row("Debug logging").click();
    await userEvent.keyboard("{/Control}");
    await f.row("Fix typo").click({ button: "right" });

    await f.screen.getByRole("menuitem", { name: "Drop 2 commits" }).click();

    const confirmation = f.screen.getByRole("alertdialog", {
      name: "Drop 2 commits from topic?",
    });
    await expect.element(confirmation).toHaveTextContent("Fix typo");
    await expect.element(confirmation).toHaveTextContent("Debug logging");
    await expect
      .element(confirmation)
      .toHaveTextContent("you'll need to force-push afterwards");
    await f.screen.getByRole("button", { name: "Drop 2 commits" }).click();
    await expect.poll(() => f.started).toHaveLength(1);
    expect(f.started[0]).toMatchObject({
      expectedHead: typo,
      operation: {
        _tag: "Rebase",
        onto: { ref: null, commit: base },
        stash: false,
      },
    });
  });

  it("asks before dropping one commit from the keyboard", async () => {
    const f = await renderDrop();
    await f.row("Fix typo").click();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect
      .element(f.screen.getByRole("menuitem", { name: "Drop commit" }))
      .toBeVisible();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect
      .element(f.screen.getByRole("menuitem", { name: "Drop commit" }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");

    const confirmation = f.screen.getByRole("alertdialog");
    await expect
      .element(confirmation)
      .toHaveTextContent("It is removed from topic.");
    await expect.element(confirmation).not.toHaveTextContent("force-push");
    await userEvent.keyboard("{Escape}");
    await expect.element(confirmation).not.toBeInTheDocument();
    expect(f.started).toEqual([]);
  });

  it.each([
    { reason: "Read only", writable: false },
    { reason: "Detached HEAD", head: { commit: typo } },
    { reason: "Rebase in progress", operation: conflictedRebase() },
  ])("says why it can't drop: $reason", async ({ reason, ...state }) => {
    const f = await renderDrop(state);
    await f.row("Add retry").click({ button: "right" });
    const drop = f.screen.getByRole("menuitem", { name: /^Drop commit/ });
    await expect.element(drop).toHaveAttribute("aria-disabled", "true");
    await expect.element(drop).toHaveTextContent(reason);
  });
});

async function renderDrop({
  writable = true,
  head = { branch: "topic", commit: typo },
  operation = repositoryOperation(),
}: {
  readonly writable?: boolean;
  readonly head?: RepositoryHead;
  readonly operation?: RepositoryOperation;
} = {}) {
  const started: StartOperation[] = [];
  const history = fakeRepositoryHistory({ commits });
  const screen = await render(
    <RepositoryScopeProvider scope={repositoryScope({ writable })}>
      <div style={{ height: 420, width: 900 }}>
        <DropGraph history={history} />
      </div>
    </RepositoryScopeProvider>,
    {
      environment: {
        requests: fakeRequests(
          respond(RepositoryOperationsApi.read, async () => operation),
          respond(RepositoryRefsApi.read, async () =>
            repositoryRefs({
              branches: [
                {
                  name: "topic",
                  target: typo,
                  upstream: upstream("origin/topic", { ahead: 2 }),
                  worktreePath: mainPath,
                },
              ],
              worktrees: [{ head, main: true, path: mainPath }],
            }),
          ),
          respond(RepositoryChangesApi.read, async () => repositoryChanges()),
          respond(RepositoryOperationsApi.start, async (input) => {
            started.push(input);
            return {
              outcome: "Rebased" as const,
              operation: repositoryOperation(),
            };
          }),
        ),
      },
    },
  );
  return {
    screen,
    started,
    row: (subject: string) =>
      screen.getByRole("row", {
        name: new RegExp(`^${subject},`),
        includeHidden: true,
      }),
  };
}

function DropGraph({ history }: { readonly history: FakeRepositoryHistory }) {
  const drop = useDropCommits(history);
  return (
    <>
      <CommitGraphFixture
        reader={history}
        drop={drop}
        repositoryName="rebase-test"
        roots={[{ name: "topic", oid: typo, type: "branch" }]}
      />
      <DropConfirmation drop={drop} />
    </>
  );
}
