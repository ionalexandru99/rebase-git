import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type CreateWorktree,
  type RemoveWorktree,
  RepositoryWorktreesApi,
  type WorktreeTarget,
} from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  commitId,
  mainPath,
  repositoryId,
  repositoryRefs,
  repositoryScope,
  topicPath,
  worktree,
} from "#tests-support/fixtures.ts";
import { render, testChanges } from "#tests-support/render.tsx";
import { WorktreeSwitcher } from "#web/features/worktrees/worktree-switcher.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const fixPath = "/repo/.worktrees/fix";
const spikePath = "/repo/.worktrees/spike";

describe("worktree switcher", () => {
  it("switches from the keyboard and removes, unlocks or prunes from the list", async () => {
    const { screen, switched, removed, unlocked } = await renderSwitcher();

    await screen.getByRole("button", { name: "Worktree repo" }).click();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(switched).toHaveBeenCalledWith(topicPath);

    await screen.getByRole("button", { name: "Worktree repo" }).click();
    await screen.getByRole("option", { name: /^topic/ }).click({
      button: "right",
    });
    await screen.getByRole("menuitem", { name: "Remove…" }).click();
    await screen
      .getByRole("alertdialog", { name: "Remove “topic”?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await vi.waitFor(() =>
      expect(removed).toEqual([
        { repositoryId, worktreePath: mainPath, target: topicPath, changes: 2 },
      ]),
    );

    await screen.getByRole("button", { name: "Worktree repo" }).click();
    await screen.getByRole("option", { name: /^fix/ }).click({
      button: "right",
    });
    await expect
      .element(screen.getByRole("menuitem", { name: /Remove…/ }))
      .toHaveAttribute("aria-disabled", "true");
    await screen.getByRole("menuitem", { name: "Unlock" }).click();
    await screen.getByRole("button", { name: "Prune spike" }).click();
    await vi.waitFor(() =>
      expect({ unlocked, removed: removed.at(-1) }).toEqual({
        unlocked: [{ repositoryId, worktreePath: mainPath, target: fixPath }],
        removed: {
          repositoryId,
          worktreePath: mainPath,
          target: spikePath,
          changes: 0,
        },
      }),
    );
  });

  it("starts counting changes on hover and marks the list busy until they arrive", async () => {
    const counted = Promise.withResolvers<void>();
    const { screen, counting } = await renderSwitcher(counted.promise);

    await screen.getByRole("button", { name: "Worktree repo" }).hover();
    await vi.waitFor(() => expect(counting).toHaveBeenCalledOnce());
    await screen.getByRole("button", { name: "Worktree repo" }).click();
    const list = screen.getByRole("listbox", { name: "Worktrees" });
    await expect.element(list).toHaveAttribute("aria-busy", "true");
    counted.resolve();

    await expect
      .element(screen.getByRole("option", { name: /1 unstaged, 1 staged$/ }))
      .toBeInTheDocument();
    await expect.element(list).toHaveAttribute("aria-busy", "false");
  });

  it("creates a branch worktree in the repository folder, or offers the worktree that already has it", async () => {
    const { screen, switched, created } = await renderSwitcher();

    await screen.getByRole("button", { name: "Worktree repo" }).click();
    await screen.getByRole("option", { name: "New worktree…" }).click();
    await userEvent.keyboard("topic");
    await expect.element(screen.getByText("Open in topic")).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("textbox", { name: "Branch" }));
    await userEvent.keyboard("feature/x");
    await expect
      .element(screen.getByRole("textbox", { name: "Folder" }))
      .toHaveValue("/trees/feature-x");
    await expect
      .element(screen.getByText("New branch from main"))
      .toBeInTheDocument();
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() =>
      expect(created).toEqual([
        {
          repositoryId,
          worktreePath: mainPath,
          path: "/trees/feature-x",
          start: { _tag: "NewBranch", name: "feature/x", startPoint: commitId },
        },
      ]),
    );
    expect(switched).toHaveBeenCalledWith("/trees/feature-x");
  });
});

async function renderSwitcher(counted: Promise<void> = Promise.resolve()) {
  const switched = vi.fn<(path: string) => void>();
  const removed: RemoveWorktree[] = [];
  const unlocked: WorktreeTarget[] = [];
  const created: CreateWorktree[] = [];
  const counting = vi.fn();
  const requests = fakeRequests(
    respond(RepositoryRefsApi.read, async () =>
      repositoryRefs({
        branches: [
          { name: "main", worktreePath: mainPath },
          { name: "topic", worktreePath: topicPath },
          { name: "fix", worktreePath: fixPath },
        ],
        worktrees: [
          worktree(mainPath, "main"),
          worktree(topicPath, "topic"),
          { ...worktree(fixPath, "fix"), locked: "on the drive" },
          { ...worktree(spikePath, "spike"), missing: true },
        ],
      }),
    ),
    respond(RepositoryWorktreesApi.status, async () => {
      counting();
      await counted;
      return {
        worktrees: [
          { path: mainPath, unstaged: 0, staged: 0 },
          { path: topicPath, unstaged: 1, staged: 1 },
          { path: fixPath, unstaged: 0, staged: 0 },
        ],
      };
    }),
    respond(RepositoryWorktreesApi.folder, async () => ({
      folder: "/trees",
      configured: true,
      separator: "/" as const,
    })),
    respond(RepositoryWorktreesApi.remove, async (command) => {
      removed.push(command);
      return {};
    }),
    respond(RepositoryWorktreesApi.unlock, async (command) => {
      unlocked.push(command);
      return {};
    }),
    respond(RepositoryWorktreesApi.create, async (command) => {
      created.push(command);
      return { worktreePath: command.path };
    }),
  );
  const screen = await render(
    <RepositoryScopeProvider
      scope={repositoryScope({ switchWorktree: switched })}
    >
      <WorktreeSwitcher />
    </RepositoryScopeProvider>,
    { environment: { requests }, queryClient: testChanges().queryClient },
  );
  return { screen, switched, removed, unlocked, created, counting };
}
