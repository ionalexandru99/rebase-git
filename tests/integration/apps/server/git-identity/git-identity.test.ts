import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  type GitIdentity,
  GitIdentityApi,
} from "#contracts/git-identity/git-identity.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { createRepository } from "#tests-support/git.ts";
import { openIsolatedTestEnvironment } from "#tests-support/server.ts";

const exec = promisify(execFile);

describe("Git identity", () => {
  it("saves the server identity in the global config and keeps its other settings", async () => {
    const f = await fixture();
    await f.globalConfig("core.editor", "vim");

    const saved = await f.save({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    const cleared = await f.save({ name: "Ada Lovelace" });

    expect(saved).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(cleared).toEqual({ name: "Ada Lovelace" });
    expect(await f.read()).toEqual({ name: "Ada Lovelace" });
    expect(await f.globalConfig("--get", "core.editor")).toBe("vim");
  });

  it("names the included file that still sets the name after saving", async () => {
    const f = await fixture();
    await f.globalConfig("user.name", "First Name");
    await writeFile(join(f.home, "local.inc"), "[user]\n\tname = Old Name\n");
    await f.globalConfig("include.path", join(f.home, "local.inc"));

    const saved = f.save({ name: "Ada Lovelace" });

    await expect(saved).rejects.toMatchObject({
      _tag: "IdentityFailed",
      detail: expect.stringMatching(
        /local\.inc sets user\.name, so change it there\.$/,
      ),
    });
  });

  it("lets a repository override the inherited identity and fall back when the override is removed", async () => {
    const f = await fixture();
    await f.save({ name: "Ada Lovelace", email: "ada@example.com" });
    await writeFile(
      join(f.home, "work.inc"),
      "[user]\n\temail = ada@work.example\n",
    );
    await f.globalConfig(
      `includeIf.gitdir:${f.repository.replaceAll("\\", "/")}/.path`,
      join(f.home, "work.inc"),
    );

    const overridden = await f.saveRepository({ email: "ada@repo.example" });
    const removed = await f.saveRepository({});

    expect(overridden).toEqual({
      local: { email: "ada@repo.example" },
      inherited: { name: "Ada Lovelace", email: "ada@work.example" },
    });
    expect(removed).toEqual({
      local: {},
      inherited: { name: "Ada Lovelace", email: "ada@work.example" },
    });
  });

  it("rejects a commit without a name and email as a missing identity", async () => {
    const f = await fixture();
    await f.globalConfig("user.useConfigOnly", "true");
    await writeFile(join(f.repository, "file.txt"), "content\n");
    await f.git("-C", f.repository, "add", ".");
    const snapshot = await Effect.runPromise(f.changes.read(f.scope));

    const commit = Effect.runPromise(
      f.changes.commit({
        ...f.scope,
        revision: snapshot.revision,
        message: "First",
      }),
    );

    await expect(commit).rejects.toMatchObject({
      _tag: "RepositoryRejected",
      reason: "IdentityMissing",
    });
  });
});

async function fixture() {
  const { environment, home, env } =
    await openIsolatedTestEnvironment("rebase identity ");
  const repository = join(environment.home, "repository");
  await createRepository(repository, { commits: [] });
  const repositoryId = (await environment.remember(repository)).id;
  const identity = environment.routes(GitIdentityApi);
  const git = async (...args: string[]) =>
    (await exec("git", args, { env })).stdout.trim();
  return {
    home,
    repository,
    git,
    changes: environment.routes(RepositoryChangesApi),
    scope: { repositoryId, worktreePath: repository, amend: false },
    globalConfig: (...args: string[]) => git("config", "--global", ...args),
    read: () => Effect.runPromise(identity.read(undefined)),
    save: (value: GitIdentity) => Effect.runPromise(identity.save(value)),
    saveRepository: (value: GitIdentity) =>
      Effect.runPromise(
        identity.saveRepository({ repositoryId, identity: value }),
      ),
  };
}
