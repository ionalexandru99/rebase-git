import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  type PullStrategy,
  PullStrategyApi,
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
  const pull = environment.routes(PullStrategyApi);
  return {
    environment,
    mainId,
    linkedId,
    remove: (repositoryId: string) => environment.catalog.remove(repositoryId),
    storedSettings: () =>
      environment.context.read("Could not read settings", (database) =>
        database
          .select({ pullStrategy: repositorySettingTable.pullStrategy })
          .from(repositorySettingTable),
      ),
    readServer: () => pull.read(undefined),
    saveServer: (value: PullStrategy) => pull.save({ value }),
    readRepository: (repositoryId: string) =>
      pull.readRepository({ repositoryId }),
    saveRepository: (repositoryId: string, value: PullStrategy | null) =>
      pull.saveRepository({ repositoryId, value }),
  };
}
