import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type ApplyStash,
  RepositoryStashesApi,
  type SaveStash,
  type StashTarget,
} from "#contracts/repository-stashes/repository-stashes.contract.ts";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  changeDiff,
  changedFile,
  mainPath,
  repositoryChanges,
  repositoryId,
  repositoryRefs,
  repositoryScope,
  repositoryStash,
  worktree,
} from "#tests-support/fixtures.ts";
import { render, testChanges } from "#tests-support/render.tsx";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar.tsx";
import { WorkingChanges } from "#web/features/working-changes/working-changes.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const limits = repositoryStash({
  oid: "1".repeat(40),
  name: "Try larger limits",
  staged: true,
});
const reflog = repositoryStash({
  oid: "2".repeat(40),
  name: "Reflog copy",
  branch: "topic",
});

describe("stashes", () => {
  it("applies with the staged state and drops after confirming from the sidebar", async () => {
    const { screen, applied, dropped, opened } = await renderStashes();
    await screen.getByRole("treeitem", { name: /^Stashes/ }).click();
    const row = screen.getByRole("treeitem", { name: /Try larger limits/ });

    await row.click();
    expect(opened).toHaveBeenCalledWith(limits.oid);
    await row.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Apply" }).click();
    await screen
      .getByRole("menuitem", { name: "Keep staged files staged" })
      .click();
    await vi.waitFor(() =>
      expect(applied).toEqual([
        expect.objectContaining({
          oid: limits.oid,
          restoreIndex: true,
          drop: false,
        }),
      ]),
    );

    screen.getByRole("tree", { name: "Branches" }).element().focus();
    await userEvent.keyboard("{Delete}");
    await screen
      .getByRole("alertdialog", { name: "Drop Try larger limits?" })
      .getByRole("button", { name: "Drop" })
      .click();
    await vi.waitFor(() =>
      expect(dropped).toEqual([expect.objectContaining({ oid: limits.oid })]),
    );
  });

  it("stashes the selected Diffs files into a stash or a new named one", async () => {
    const { screen, saved } = await renderStashes();
    await screen
      .getByRole("button", { name: "Unstaged a.ts", exact: true })
      .click();
    await screen
      .getByRole("button", { name: "Unstaged b.ts", exact: true })
      .click({ modifiers: ["Control"] });

    await screen
      .getByRole("button", { name: "Unstaged b.ts", exact: true })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Stash" }).click();
    const into = screen.getByRole("menuitem");
    await expect
      .poll(() => into.elements().map((item) => item.textContent))
      .toEqual(
        expect.arrayContaining([
          "New stash",
          "Try larger limits",
          "Reflog copy",
        ]),
      );
    await screen.getByRole("menuitem", { name: "Reflog copy" }).click();
    await vi.waitFor(() =>
      expect(saved).toEqual([
        {
          repositoryId,
          worktreePath: mainPath,
          revision: "r1",
          section: "unstaged",
          paths: ["a.ts", "b.ts"],
          into: reflog.oid,
        },
      ]),
    );

    await screen.getByRole("button", { name: "Dismiss notification" }).click();
    const first = screen.getByRole("button", {
      name: "Unstaged a.ts",
      exact: true,
    });
    await first.click();
    await first.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Stash" }).click();
    await screen.getByRole("menuitem", { name: "New stash" }).click();
    const name = screen.getByRole("textbox", { name: "Stash name" });
    await expect.element(name).toHaveValue("WIP on main");
    await expect.element(name).toHaveFocus();
    await userEvent.keyboard("Split reads{Enter}");
    await vi.waitFor(() =>
      expect(saved.at(-1)).toEqual(
        expect.objectContaining({
          paths: ["a.ts"],
          into: null,
          name: "Split reads",
        }),
      ),
    );
  });
});

async function renderStashes() {
  const applied: ApplyStash[] = [];
  const dropped: StashTarget[] = [];
  const saved: SaveStash[] = [];
  const opened = vi.fn<(oid: string) => void>();
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryRefsApi.read, async () =>
      repositoryRefs({
        branches: [{ name: "main", worktreePath: mainPath }],
        worktrees: [worktree(mainPath, "main")],
      }),
    ),
    respond(RepositoryStashesApi.list, async () => ({
      stashes: [limits, reflog].filter(
        (stash) => !dropped.some(({ oid }) => oid === stash.oid),
      ),
      truncated: false,
    })),
    respond(RepositoryStashesApi.apply, async (command) => {
      applied.push(command);
      return { conflicts: 0 };
    }),
    respond(RepositoryStashesApi.drop, async (command) => {
      dropped.push(command);
      return {};
    }),
    respond(RepositoryStashesApi.save, async (command) => {
      saved.push(command);
      return { oid: "3".repeat(40) };
    }),
    respond(RepositoryChangesApi.read, async () =>
      repositoryChanges({
        revision: "r1",
        unstaged: [changedFile("a.ts"), changedFile("b.ts")],
      }),
    ),
    respond(RepositoryChangesApi.diff, async (command) =>
      changeDiff(command.path),
    ),
  );
  const screen = await render(
    <RepositoryScopeProvider
      scope={repositoryScope({ repositoryId, worktreePath: mainPath })}
    >
      <div style={{ display: "flex", height: 640 }}>
        <div style={{ width: 320 }}>
          <BranchesSidebar onOpenStash={opened} />
        </div>
        <div style={{ width: 960 }}>
          <WorkingChanges
            target={{
              repositoryId,
              worktreePath: mainPath,
              draftKey: "stashes",
              active: true,
            }}
            writable
          />
        </div>
      </div>
    </RepositoryScopeProvider>,
    { environment: { requests }, queryClient: testChanges().queryClient },
  );
  return { screen, applied, dropped, saved, opened };
}
