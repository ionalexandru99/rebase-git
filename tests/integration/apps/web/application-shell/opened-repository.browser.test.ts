import type { RepositoryRefs } from "@rebase/contracts";
import { expect, it, vi } from "vite-plus/test";
import { createOpenedRepositoryStore } from "#web/app/shell/opened-repository";

it("requests the first history page as soon as refs arrive", async () => {
  const repositoryId = crypto.randomUUID();
  const oid = "a".repeat(40);
  const read = vi.fn(() => new Promise<Uint8Array>(() => undefined));
  const opened = createOpenedRepositoryStore({
    read,
    synchronize: () => new Promise<number>(() => undefined),
  });
  const refs: RepositoryRefs = {
    repositoryId,
    branches: [{ name: "main", target: oid, worktreePath: "/repo" }],
    remoteBranches: [],
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: "main", commit: oid }, main: true, path: "/repo" },
    ],
  };

  opened.open({
    environmentId: crypto.randomUUID(),
    repositoryId,
    logicalRepositoryId: repositoryId,
    worktreePath: "/repo",
  });
  opened.refsArrived({ ...refs, repositoryId: crypto.randomUUID() });
  opened.refsArrived(refs);

  try {
    await expect
      .poll(() => read)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryId,
          roots: [{ name: "main", oid, type: "branch" }],
        }),
        expect.any(AbortSignal),
      );
    opened.refsArrived(refs);
    expect(read).toHaveBeenCalledOnce();
  } finally {
    opened.open(undefined);
  }
  expect(opened.getSnapshot()).toBeUndefined();
});
