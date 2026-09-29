import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  RepositoryReflogApi,
  type ResetToCommit,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  commitId,
  mainPath,
  reflogEntry,
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
    await screen.getByRole("menuitem", { name: /Show in graph/ }).click();
    expect(shown).toHaveBeenCalledWith(beforeRebase);

    await screen
      .getByRole("treeitem", { name: /Retry checkout on timeout/ })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Reset" }).click();
    await screen
      .getByRole("menuitem", { name: "Keep changes unstaged" })
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
});

function reflogFixture() {
  const resets: ResetToCommit[] = [];
  const requests = fakeRequests(
    idleOperation,
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
      return { head: command.target };
    }),
  );
  return { requests, resets };
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
