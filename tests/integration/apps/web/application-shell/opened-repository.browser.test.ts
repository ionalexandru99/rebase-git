import type { RepositoryRefs } from "@rebase/contracts";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { createOpenedRepositoryStore } from "#web/app/shell/opened-repository";
import { createRepositoryRefsController } from "#web/features/repository-refs/repository-refs-controller";

it("requests the first history page as soon as refs arrive", async () => {
  const repositoryId = crypto.randomUUID();
  const oid = "a".repeat(40);
  const refs = Promise.withResolvers<RepositoryRefs>();
  const refsController = createRepositoryRefsController({
    checkout: () => Effect.die("Checkout is not used"),
    read: () => Effect.promise(() => refs.promise),
  });
  const read = vi.fn(() => new Promise<Uint8Array>(() => undefined));
  const opened = createOpenedRepositoryStore({
    history: { read, synchronize: () => new Promise<number>(() => undefined) },
    refs: refsController,
  });

  refsController.select(repositoryId);
  opened.open({
    environmentId: crypto.randomUUID(),
    repositoryId,
    logicalRepositoryId: repositoryId,
    worktreePath: "/repo",
  });
  refs.resolve({
    repositoryId,
    branches: [{ name: "main", target: oid, worktreePath: "/repo" }],
    remoteBranches: [],
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: "main", commit: oid }, main: true, path: "/repo" },
    ],
  });

  try {
    await vi.waitFor(() =>
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryId,
          roots: [{ name: "main", oid, type: "branch" }],
        }),
        expect.any(AbortSignal),
      ),
    );
  } finally {
    opened.open(undefined);
  }
  expect(opened.getSnapshot()).toBeUndefined();
});
