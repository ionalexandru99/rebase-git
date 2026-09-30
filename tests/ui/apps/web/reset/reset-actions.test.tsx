import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  RepositoryReflogApi,
  type ResetFailure,
  type ResetToCommit,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { CommitGraphFixture } from "#tests-support/commit-graph-fixture.tsx";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  conflictedRebase,
  mainPath,
  repositoryOperation,
  repositoryRefs,
  repositoryScope,
} from "#tests-support/fixtures.ts";
import {
  historyCommit as commit,
  type FakeRepositoryHistory,
  fakeRepositoryHistory,
  historyOid,
} from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { NotificationsProvider } from "#web/features/notifications/notifications.tsx";
import {
  ResetConfirmation,
  useResetActions,
} from "#web/features/reset/reset-actions.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const main = historyOid(0);
const parent = historyOid(1);
const base = historyOid(2);
const commits = [
  commit(main, [parent], 0, "Main"),
  commit(parent, [base], 1, "Parent"),
  commit(base, [], 2, "Base"),
];
const refs = repositoryRefs({
  branches: [{ name: "main", target: main, worktreePath: mainPath }],
  worktrees: [
    { head: { branch: "main", commit: main }, main: true, path: mainPath },
  ],
});

describe("reset actions", () => {
  it("resets the current branch to a graph commit with the keyboard", async () => {
    const reset = resetFixture();
    const screen = await renderReset(reset);
    await screen
      .getByRole("grid")
      .getByRole("row", { name: /^Parent,/ })
      .click();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Reset" }))
      .toBeVisible();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Keep changes staged" }))
      .toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Keep changes unstaged" }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => reset.calls)
      .toEqual([
        expect.objectContaining({
          target: parent,
          mode: "mixed",
          expectedHead: main,
        }),
      ]);
  });

  it("lists the files a hard reset discards and sends the confirmed fingerprint", async () => {
    const reset = resetFixture();
    reset.failures.push({
      _tag: "ResetDiscardsChanges",
      paths: ["src/config.ts", "src/retry.ts"],
      count: 2,
      fingerprint: "f".repeat(64),
    });
    const screen = await renderReset(reset);
    await openReset(screen, /^Base,/);
    await screen.getByRole("menuitem", { name: "Discard changes…" }).click();
    const confirmation = screen.getByRole("alertdialog");
    await expect
      .element(confirmation)
      .toHaveTextContent("Uncommitted edits in 2 files will be lost.");
    await expect.element(confirmation).toHaveTextContent("src/retry.ts");

    await screen.getByRole("button", { name: "Discard and reset" }).click();
    await expect.element(confirmation).not.toBeInTheDocument();
    expect(reset.calls.at(-1)).toMatchObject({
      target: base,
      mode: "hard",
      discard: "f".repeat(64),
    });
  });

  it("explains why the branch cannot move and reports a moved head", async () => {
    const rebasing = await renderReset(resetFixture(conflictedRebase()));
    await rebasing
      .getByRole("grid")
      .getByRole("row", { name: /^Base,/ })
      .click({ button: "right" });
    const blocked = rebasing.getByRole("menuitem", {
      name: /^Reset/,
    });
    await expect.element(blocked).toHaveTextContent("Rebase in progress");
    await expect.element(blocked).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    await rebasing.unmount();

    const moved = resetFixture();
    moved.failures.push({ _tag: "HeadMoved", head: parent });
    const screen = await renderReset(moved);
    await openReset(screen, /^Base,/);
    await screen.getByRole("menuitem", { name: "Keep changes staged" }).click();
    await expect
      .element(
        screen.getByText("main moved before the reset ran. Nothing changed."),
      )
      .toBeVisible();
  });
});

function resetFixture(operation: RepositoryOperation = repositoryOperation()) {
  const calls: ResetToCommit[] = [];
  const failures: ResetFailure[] = [];
  const requests = fakeRequests(
    respond(RepositoryOperationsApi.read, async () => operation),
    respond(RepositoryRefsApi.read, () => refs),
    respond(RepositoryReflogApi.reset, async (command) => {
      calls.push(command);
      const failure = failures.shift();
      if (failure !== undefined) throw rejected(failure);
      return { head: command.target };
    }),
  );
  return { requests, calls, failures };
}

async function openReset(
  screen: Awaited<ReturnType<typeof renderReset>>,
  row: RegExp,
) {
  await screen
    .getByRole("grid")
    .getByRole("row", { name: row })
    .click({ button: "right" });
  await screen.getByRole("menuitem", { name: "Reset" }).click();
}

function renderReset(reset: ReturnType<typeof resetFixture>) {
  const history = fakeRepositoryHistory({ commits });
  return render(
    <NotificationsProvider>
      <RepositoryScopeProvider scope={repositoryScope()}>
        <div style={{ height: 420, width: 900 }}>
          <ResetGraph history={history} />
        </div>
      </RepositoryScopeProvider>
    </NotificationsProvider>,
    { environment: { requests: reset.requests } },
  );
}

function ResetGraph({ history }: { readonly history: FakeRepositoryHistory }) {
  const reset = useResetActions();
  return (
    <>
      <CommitGraphFixture
        reader={history}
        reset={reset}
        repositoryName="rebase-test"
        roots={[{ name: "main", oid: main, type: "branch" }]}
      />
      <ResetConfirmation reset={reset} />
    </>
  );
}
