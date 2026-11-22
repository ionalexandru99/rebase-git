import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { FetchPruneApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { createRepository } from "#tests-support/git.ts";
import { openIsolatedTestEnvironment } from "#tests-support/server.ts";

const exec = promisify(execFile);

describe("fetch prune setting with real Git", () => {
  it("reads Git boolean spellings and falls back to the server value when the repository clears its own", async () => {
    const { environment, env } =
      await openIsolatedTestEnvironment("rebase prune ");
    const repository = join(environment.home, "repository");
    await createRepository(repository, { commits: [] });
    const repositoryId = (await environment.remember(repository)).id;
    const git = (...args: string[]) => exec("git", args, { env });
    await git("config", "--global", "fetch.prune", "no");
    await git("-C", repository, "config", "fetch.prune", "1");
    const prune = environment.routes(FetchPruneApi);

    const server = await prune.read(undefined);
    const overridden = await prune.readRepository({ repositoryId });
    const cleared = await prune.saveRepository({ repositoryId, value: null });

    expect(server).toBe(false);
    expect(overridden).toEqual({ repository: true, server: false });
    expect(cleared).toEqual({ repository: null, server: false });
  });
});
