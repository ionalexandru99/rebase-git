import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  RepositoryOperationsApi,
  type StartOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  commitInspection,
  mainPath,
  repositoryChanges,
  repositoryOperation,
  repositoryRefs,
  repositoryScope,
} from "#tests-support/fixtures.ts";
import {
  fakeRepositoryHistory,
  historyCommit,
  historyOid,
} from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { RebasePanel } from "#web/features/rebase/rebase-panel.tsx";
import type { RebasePlanTarget } from "#web/features/rebase/rebase-plan.ts";
import { PanelFeatureContext } from "#web/features/workspace-panel/api.ts";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const main = historyOid(1);
const engine = historyOid(2);
const wip = historyOid(3);
const tests = historyOid(4);
const fixup = historyOid(5);

describe("interactive rebase tab", () => {
  it("edits the plan from the keyboard and starts the rebase with the squashed message", async () => {
    const f = await fixture();
    const plan = f.screen.getByRole("listbox", { name: "Plan" });
    await expect
      .element(plan.getByRole("option").first())
      .toHaveTextContent(/fixup.*fixup! Add tests/);
    await plan.getByRole("option", { name: /wip/ }).click();
    await userEvent.keyboard("s");
    await expect
      .element(f.screen.getByLabelText("Message body"))
      .toHaveValue("Engine body\n\nwip");
    await plan.getByRole("option", { name: /^pick\s*Add tests/ }).click();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await plan.getByRole("option", { name: /wip/ }).click();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Control>}a{/Control}Add rules engine");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect
      .poll(() => f.started)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          expectedHead: fixup,
          operation: {
            _tag: "Rebase",
            onto: { ref: "main", commit: main },
            stash: false,
            plan: [
              {
                commit: engine,
                action: "pick",
                message: "Add rules engine\n\nEngine body\n\nwip",
              },
              { commit: wip, action: "squash", message: null },
              { commit: fixup, action: "fixup", message: null },
              { commit: tests, action: "pick", message: null },
            ],
          },
        }),
      );
    expect(f.closed).toHaveBeenCalled();
  });

  it("refuses to start a squash with nothing older to fold into", async () => {
    const f = await fixture();
    await f.screen
      .getByRole("listbox", { name: "Plan" })
      .getByRole("option", { name: /Add engine/ })
      .click({ button: "right" });
    await f.screen.getByRole("menuitem", { name: /Squash/ }).click();
    await expect
      .element(f.screen.getByRole("alert"))
      .toHaveTextContent("Nothing older to squash into.");
    await expect
      .element(f.screen.getByRole("button", { name: "Start rebase" }))
      .toBeDisabled();
  });

  it("shows a failed start as a toast and keeps the plan open", async () => {
    const f = await fixture();
    f.started.mockImplementation(() => {
      throw rejected({
        _tag: "OperationFailed",
        reason: "GitRejected",
        detail: "Git refused the rebase.",
      });
    });
    await f.screen.getByRole("button", { name: "Start rebase" }).click();
    await expect
      .element(page.getByText("Git refused the rebase."))
      .toBeVisible();
    await expect
      .element(f.screen.getByRole("region", { name: "Rebase plan" }))
      .toBeVisible();
    expect(f.closed).not.toHaveBeenCalled();
  });

  it("shows where a running plan stopped under the operation controls", async () => {
    const f = await fixture(
      repositoryOperation({
        kind: "rebase",
        phase: "edit",
        revision: "a".repeat(64),
        branch: "topic",
        actions: [{ action: "continue", enabled: true, reason: null }],
        steps: [
          { commit: engine, action: "pick", subject: "Add engine", done: true },
          { commit: wip, action: "edit", subject: "wip", done: true },
          { commit: tests, action: "pick", subject: "Add tests", done: false },
        ],
      }),
    );
    await expect
      .element(f.screen.getByRole("button", { name: "Continue rebase" }))
      .toBeVisible();
    await expect
      .element(f.screen.getByRole("listitem").nth(1))
      .toHaveAttribute("aria-current", "step");
    await expect
      .element(f.screen.getByRole("listitem").nth(1))
      .toHaveTextContent(/edit.*wip/);
  });
  it("keeps another operation's controls in reach while the plan waits", async () => {
    const f = await fixture(
      repositoryOperation({
        kind: "merge",
        phase: "conflicts",
        revision: "b".repeat(64),
        branch: "topic",
        unresolvedPaths: ["engine.ts"],
        actions: [
          { action: "continue", enabled: false, reason: "Resolve 1 file." },
          { action: "abort", enabled: true, reason: null },
        ],
      }),
    );
    await expect
      .element(f.screen.getByRole("button", { name: "Continue merge" }))
      .toBeVisible();
    await expect
      .element(f.screen.getByText("Another operation is in progress."))
      .toBeVisible();
  });
});

async function fixture(operation = repositoryOperation()) {
  const started = vi.fn<(command: StartOperation) => void>();
  const closed = vi.fn();
  const history = fakeRepositoryHistory({
    commits: [
      historyCommit(fixup, [tests], 5, "fixup! Add tests"),
      historyCommit(tests, [wip], 4, "Add tests"),
      historyCommit(wip, [engine], 3, "wip"),
      historyCommit(engine, [main], 2, "Add engine"),
      historyCommit(main, [], 1, "Base"),
    ],
  });
  const messages: Record<string, string> = {
    [engine]: "Add engine\n\nEngine body\n",
    [wip]: "wip\n",
  };
  const requests = fakeRequests(
    respond(RepositoryOperationsApi.read, async () => operation),
    respond(RepositoryRefsApi.read, async () =>
      repositoryRefs({
        branches: [
          { name: "topic", target: fixup, worktreePath: mainPath },
          { name: "main", target: main },
        ],
        worktrees: [
          {
            head: { branch: "topic", commit: fixup },
            main: true,
            path: mainPath,
          },
        ],
      }),
    ),
    respond(RepositoryChangesApi.read, async () => repositoryChanges()),
    respond(CommitInspectionApi.inspect, async ({ oid }) =>
      commitInspection({ oid, message: messages[oid] ?? "Commit" }),
    ),
    respond(RepositoryOperationsApi.start, async (command) => {
      started(command);
      return {
        outcome: "Rebased" as const,
        operation: repositoryOperation(),
      };
    }),
  );
  const target: RebasePlanTarget = { ref: "main", commit: main, from: false };
  const screen = await render(
    <RepositoryScopeProvider scope={repositoryScope()}>
      <PanelFeatureContext.Provider
        value={{
          scope: undefined,
          environment: undefined,
          active: true,
          input: target,
          expanded: false,
          expand: () => {},
        }}
      >
        <div style={{ height: 520, width: 440 }}>
          <RebasePanel history={history} onClose={closed} />
        </div>
      </PanelFeatureContext.Provider>
    </RepositoryScopeProvider>,
    { environment: { requests } },
  );
  return { screen, started, closed };
}
