import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import {
  GitSigningApi,
  type SigningChoice,
} from "#contracts/git-signing/git-signing.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { createRepository } from "#tests-support/git.ts";
import { openIsolatedTestEnvironment } from "#tests-support/server.ts";

const exec = promisify(execFile);

describe("Git signing", () => {
  it("lists the SSH keys in the home folder and signs commits with the chosen one", async () => {
    const f = await fixture();
    await f.sshKey("id_ed25519", "");

    const listed = (await f.keys()).find(({ label }) => label === "id_ed25519");
    expect(listed).toMatchObject({ format: "ssh" });
    const saved = await f.save({
      _tag: "Key",
      format: "ssh",
      key: listed?.key ?? "",
    });
    await f.commit();

    expect(saved).toEqual({ _tag: "Key", ...listed });
    expect(
      await f.git("-C", f.repository, "cat-file", "commit", "HEAD"),
    ).toContain("-----BEGIN SSH SIGNATURE-----");
  });

  it("turns signing off without forgetting the key and lets a repository choose its own", async () => {
    const f = await fixture();
    const key = { _tag: "Key", format: "ssh", key: "/keys/work.pub" } as const;
    await f.save(key);

    const off = await f.save({ _tag: "Off" });
    const overridden = await f.saveRepository(key);
    const inherited = await f.saveRepository(null);

    expect(off).toEqual({ _tag: "Off" });
    expect(await f.globalConfig("--get", "user.signingKey")).toBe(
      "/keys/work.pub",
    );
    expect(overridden).toEqual({
      local: { ...key, label: "work" },
      inherited: { _tag: "Off" },
    });
    expect(inherited).toEqual({ local: null, inherited: { _tag: "Off" } });
  });

  it("rejects a commit at once when the SSH key needs a passphrase nobody can type", async () => {
    const f = await fixture();
    const key = await f.sshKey("id_locked", "secret passphrase");
    await f.save({ _tag: "Key", format: "ssh", key });

    const commit = f.commit();

    await expect(commit).rejects.toMatchObject({
      _tag: "RepositoryRejected",
      reason: "SigningLocked",
      detail: "Add id_locked to your SSH agent, then try again.",
    });
  });
});

async function fixture() {
  const { environment, home, env } = await openIsolatedTestEnvironment(
    "rebase signing ",
    { SSH_AUTH_SOCK: "", SSH_ASKPASS: "", DISPLAY: "", WAYLAND_DISPLAY: "" },
  );
  const git = async (...args: string[]) =>
    (await exec("git", args, { env })).stdout.trim();
  onTestFinished(() =>
    git("-c", "alias.stop-agents=!gpgconf --kill all", "stop-agents").then(
      () => undefined,
      () => undefined,
    ),
  );
  await git("config", "--global", "user.name", "Ada Lovelace");
  await git("config", "--global", "user.email", "ada@example.com");
  const repository = join(environment.home, "repository");
  await createRepository(repository, { commits: [] });
  const repositoryId = (await environment.remember(repository)).id;
  const signing = environment.routes(GitSigningApi);
  const changes = environment.routes(RepositoryChangesApi);
  const scope = { repositoryId, worktreePath: repository, amend: false };
  return {
    repository,
    git,
    globalConfig: (...args: string[]) => git("config", "--global", ...args),
    sshKey: async (name: string, passphrase: string) => {
      const folder = join(home, ".ssh");
      await mkdir(folder, { recursive: true });
      await exec(
        "ssh-keygen",
        ["-q", "-t", "ed25519", "-N", passphrase, "-C", name, "-f", name],
        { cwd: folder },
      );
      return join(folder, `${name}.pub`);
    },
    keys: () => Effect.runPromise(signing.keys(undefined)),
    save: (choice: SigningChoice) => Effect.runPromise(signing.save(choice)),
    saveRepository: (choice: SigningChoice | null) =>
      Effect.runPromise(
        signing.saveRepository({ repositoryId, signing: choice }),
      ),
    commit: async () => {
      await writeFile(join(repository, "file.txt"), "content\n");
      await git("-C", repository, "add", ".");
      const snapshot = await Effect.runPromise(changes.read(scope));
      return Effect.runPromise(
        changes.commit({
          ...scope,
          revision: snapshot.revision,
          message: "Signed",
        }),
      );
    },
  };
}
