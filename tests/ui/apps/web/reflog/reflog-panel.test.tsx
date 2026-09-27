import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  RepositoryReflogApi,
  type ResetFailure,
  type ResetToCommit,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  commitId,
  conflictedRebase,
  mainPath,
  reflogEntry,
  repositoryOperation,
  repositoryRefs,
  repositoryScope,
  worktree,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { NotificationsProvider } from "#web/features/notifications/notifications.tsx";
import { ReflogPanel } from "#web/features/reflog/reflog-panel.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const head = commitId;
const beforeRebase = "b".repeat(40);
const picked = "c".repeat(40);

describe("reflog panel", () => {
  it("groups a rebase and runs the row menu actions", async () => {
    const reflog = reflogFixture();
    const shown = vi.fn(async (_oid: string) => undefined);
    const screen = await renderPanel(reflog, shown);

    const rebase = screen.getByRole("treeitem", { name: /Rebased onto main/ });
    await expect.element(rebase).toHaveAttribute("aria-expanded", "false");
    await rebase.click();
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("treeitem", { name: /pick Add retry/ }))
      .toBeVisible();

    await screen
      .getByRole("treeitem", { name: /Retry checkout on timeout/ })
      .click({ button: "right" });
    await expect
      .element(screen.getByRole("menuitem", { name: /keep changes staged/ }))
      .toHaveTextContent("soft");
    await screen.getByRole("menuitem", { name: /Show in graph/ }).click();
    expect(shown).toHaveBeenCalledWith(beforeRebase);

    await screen
      .getByRole("treeitem", { name: /Retry checkout on timeout/ })
      .click({ button: "right" });
    await screen
      .getByRole("menuitem", { name: /keep changes unstaged/ })
      .click();
    await vi.waitFor(() =>
      expect(reflog.resets).toEqual([
        expect.objectContaining({
          target: beforeRebase,
          mode: "mixed",
          expectedHead: head,
        }),
      ]),
    );
  });

  it("lists the files a hard reset discards and sends the confirmed fingerprint", async () => {
    const reflog = reflogFixture();
    reflog.failures.push({
      _tag: "ResetDiscardsChanges",
      paths: ["src/config.ts", "src/retry.ts"],
      count: 2,
      fingerprint: "f".repeat(64),
    });
    const screen = await renderPanel(reflog);

    await screen
      .getByRole("treeitem", { name: /Retry checkout on timeout/ })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: /discard changes/ }).click();
    const confirmation = screen.getByRole("alertdialog");
    await expect
      .element(confirmation)
      .toHaveTextContent("Uncommitted edits in 2 files will be lost.");
    await expect.element(confirmation).toHaveTextContent("src/retry.ts");

    await screen.getByRole("button", { name: "Discard and move" }).click();
    await expect.element(confirmation).not.toBeInTheDocument();
    expect(reflog.resets.at(-1)).toMatchObject({
      mode: "hard",
      discard: "f".repeat(64),
    });
  });

  it("explains why the branch cannot move and reports a moved head", async () => {
    const rebasing = reflogFixture(conflictedRebase());
    const blocked = await renderPanel(rebasing);
    await blocked
      .getByRole("treeitem", { name: /Retry checkout on timeout/ })
      .click({ button: "right" });
    await expect
      .element(blocked.getByRole("menuitem", { name: /keep changes staged/ }))
      .toHaveTextContent("Rebase in progress");
    await expect
      .element(blocked.getByRole("menuitem", { name: /keep changes staged/ }))
      .toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    await blocked.unmount();

    const moved = reflogFixture();
    moved.failures.push({ _tag: "HeadMoved", head: picked });
    const screen = await renderPanel(moved);
    await screen
      .getByRole("treeitem", { name: /Retry checkout on timeout/ })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: /keep changes staged/ }).click();
    await expect
      .element(screen.getByText(/moved to ccccccc before the reset ran/))
      .toBeVisible();
  });
});

function reflogFixture(operation: RepositoryOperation = repositoryOperation()) {
  const resets: ResetToCommit[] = [];
  const failures: ResetFailure[] = [];
  const requests = fakeRequests(
    respond(RepositoryOperationsApi.read, async () => operation),
    respond(RepositoryRefsApi.read, async () =>
      repositoryRefs({
        branches: [
          {
            name: "feature/retry",
            target: head,
            worktreePath: mainPath,
          },
        ],
        worktrees: [worktree(mainPath, "feature/retry")],
      }),
    ),
    respond(RepositoryReflogApi.read, async () => ({
      truncated: false,
      entries: [
        reflogEntry({
          action: "rebase",
          description: "Rebased onto main",
          oid: head,
          previousOid: beforeRebase,
          steps: [{ oid: picked, label: "pick", description: "Add retry" }],
        }),
        reflogEntry({
          description: "Retry checkout on timeout",
          subject: "Retry checkout on timeout",
          oid: beforeRebase,
          orphaned: true,
        }),
      ],
    })),
    respond(RepositoryReflogApi.reset, async (command) => {
      resets.push(command);
      const failure = failures.shift();
      if (failure !== undefined) throw rejected(failure);
      return { head: command.target };
    }),
  );
  return { requests, resets, failures };
}

function renderPanel(
  reflog: ReturnType<typeof reflogFixture>,
  onShowInGraph: (oid: string) => Promise<void> = async () => undefined,
) {
  return render(
    <NotificationsProvider>
      <RepositoryScopeProvider scope={repositoryScope()}>
        <div style={{ height: 480 }}>
          <ReflogPanel
            onOpenDetails={() => undefined}
            onShowInGraph={onShowInGraph}
          />
        </div>
      </RepositoryScopeProvider>
    </NotificationsProvider>,
    { environment: { requests: reflog.requests } },
  );
}
