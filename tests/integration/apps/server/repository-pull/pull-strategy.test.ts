import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  type PullStrategy,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { repositorySettingTable } from "#server/persistence/environment-state.schema.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

describe("pull strategy settings", () => {
  it("saves the server value, which a repository without its own value inherits", async () => {
    const f = await fixture();

    const initial = await f.readServer();
    const saved = await f.saveServer("rebase");

    expect(initial).toBe("ask");
    expect(saved).toBe("rebase");
    expect(await f.readServer()).toBe("rebase");
    expect(await f.readRepository(f.mainId)).toEqual({
      repository: null,
      server: "rebase",
    });
  });

  it("shares a repository value across its worktrees and falls back to the server value when cleared", async () => {
    const f = await fixture();
    const changed: (readonly string[] | undefined)[] = [];
    f.environment.events.subscribe((_, repositoryIds) =>
      changed.push(repositoryIds),
    );

    const overridden = await f.saveRepository(f.linkedId, "merge");
    const fromMain = await f.readRepository(f.mainId);
    const cleared = await f.saveRepository(f.mainId, null);

    expect(overridden).toEqual({ repository: "merge", server: "ask" });
    expect(fromMain).toEqual({ repository: "merge", server: "ask" });
    expect(cleared).toEqual({ repository: null, server: "ask" });
    expect(await f.readRepository(f.linkedId)).toEqual(cleared);
    expect(await f.storedSettings()).toEqual([]);
    expect(changed.map((ids) => [...(ids ?? [])].sort())).toEqual([
      [f.mainId, f.linkedId].sort(),
      [f.mainId, f.linkedId].sort(),
    ]);
  });

  it("keeps a repository value until the last worktree of the repository is removed", async () => {
    const f = await fixture();
    await f.saveRepository(f.linkedId, "merge");

    await f.remove(f.linkedId);
    const afterLinked = await f.storedSettings();
    await f.remove(f.mainId);

    expect(afterLinked).toEqual([{ pullStrategy: "merge" }]);
    expect(await f.storedSettings()).toEqual([]);
  });
});

async function fixture() {
  const environment = await openTestEnvironment();
  const main = join(environment.home, "repository");
  const linked = join(environment.home, "linked worktree");
  await createRepository(main);
  await git(main, "worktree", "add", linked, "-b", "feature");
  const mainId = (await environment.remember(main)).id;
  const linkedId = (await environment.remember(linked)).id;
  const pull = environment.routes(RepositoryPullApi);
  return {
    environment,
    mainId,
    linkedId,
    remove: (repositoryId: string) =>
      Effect.runPromise(environment.catalog.remove(repositoryId)),
    storedSettings: () =>
      Effect.runPromise(
        environment.context.read("Could not read settings", (database) =>
          database
            .select({ pullStrategy: repositorySettingTable.pullStrategy })
            .from(repositorySettingTable),
        ),
      ),
    readServer: () => Effect.runPromise(pull.readPullStrategy(undefined)),
    saveServer: (strategy: PullStrategy) =>
      Effect.runPromise(pull.savePullStrategy({ strategy })),
    readRepository: (repositoryId: string) =>
      Effect.runPromise(pull.readRepositoryPullStrategy({ repositoryId })),
    saveRepository: (repositoryId: string, strategy: PullStrategy | null) =>
      Effect.runPromise(
        pull.saveRepositoryPullStrategy({ repositoryId, strategy }),
      ),
  };
}
