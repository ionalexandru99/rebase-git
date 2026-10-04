import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { cloneRepository, fastImport, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

const committer = "committer Rebase test <rebase@example.test> 0 +0000\n";

describe("repository fetch with real Git", () => {
  it("fetches the default remote, prunes deleted branches and recovers after a failure", async () => {
    const f = await fixture();
    await git(f.remote, "branch", "temporary", "main");
    await expect(f.fetch()).resolves.toMatchObject({ fetching: false });
    await git(f.local, "rev-parse", "refs/remotes/origin/temporary");
    await git(f.remote, "branch", "-D", "temporary");
    await f.fetch();
    await expect(
      git(f.local, "show-ref", "--verify", "refs/remotes/origin/temporary"),
    ).rejects.toThrow();
    const cachedHead = await git(f.local, "rev-parse", "HEAD");
    await git(f.local, "remote", "set-url", "origin", join(f.root, "missing"));

    await expect(f.fetch()).rejects.toMatchObject({ _tag: "FetchFailed" });
    await expect(f.status()).resolves.toMatchObject({
      failure: { _tag: "FetchFailed" },
    });
    expect(await git(f.local, "rev-parse", "HEAD")).toBe(cachedHead);

    await git(f.local, "remote", "set-url", "origin", f.remote);
    const recovered = await f.fetch();
    expect(recovered).not.toHaveProperty("failure");
  });

  it("keeps deleted remote branches when the repository turns pruning off", async () => {
    const f = await fixture();
    await git(f.remote, "branch", "temporary", "main");
    await f.fetch();
    await git(f.remote, "branch", "-D", "temporary");

    await expect(f.savePrune(false)).resolves.toMatchObject({
      repository: false,
    });
    await f.fetch();

    await git(f.local, "rev-parse", "refs/remotes/origin/temporary");
  });

  it("persists the interval in the repository config", async () => {
    const f = await fixture();

    await expect(
      f.configure({ _tag: "Interval", seconds: 600 }),
    ).resolves.toMatchObject({ setting: { _tag: "Interval", seconds: 600 } });

    expect(
      await git(f.local, "config", "--get", "rebase.autoFetchIntervalSeconds"),
    ).toBe("600");
  });
});

async function fixture() {
  const environment = await openTestEnvironment();
  environment.events.subscribe(() => {});
  const root = environment.home;
  const remote = join(root, "remote.git");
  const local = join(root, "local");
  await git(root, "init", "--bare", "-b", "main", remote);
  await fastImport(
    remote,
    `commit refs/heads/main\n${committer}data <<END\nbase\nEND\nM 100644 inline file.txt\ndata <<END\nbase\nEND\n`,
  );
  await cloneRepository(
    remote,
    local,
    "--config",
    "rebase.autoFetchIntervalSeconds=0",
  );
  const repositoryId = (await environment.remember(local)).id;
  const routes = environment.routes(RepositoryPullApi);
  return {
    root,
    remote,
    local,
    fetch: () => Effect.runPromise(routes.fetch({ repositoryId })),
    status: () => Effect.runPromise(routes.fetchStatus({ repositoryId })),
    savePrune: (prune: boolean | null) =>
      Effect.runPromise(
        routes.saveRepositoryFetchPrune({ repositoryId, prune }),
      ),
    configure: (
      setting: Parameters<typeof routes.configureFetch>[0]["setting"],
    ) => Effect.runPromise(routes.configureFetch({ repositoryId, setting })),
  };
}
