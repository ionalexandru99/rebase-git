import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { SignatureVerificationApi } from "#contracts/signature-verification/signature-verification.contract.ts";
import { createRepository } from "#tests-support/git.ts";
import { openIsolatedTestEnvironment } from "#tests-support/server.ts";

const exec = promisify(execFile);
const signer = "signer@example.test";

describe("signature verification", () => {
  it("checks SSH-signed commits and tags with the allowed signers the Environment has", async () => {
    const { home, git, verify } = await fixture();
    for (const key of ["signer", "other"])
      await exec("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "",
        "-f",
        join(home, key),
      ]);
    const sign = [
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingKey=${join(home, "signer")}`,
    ];
    await git(...sign, "commit", "-q", "-S", "--allow-empty", "-m", "Signed");
    await git(...sign, "tag", "-s", "-m", "Signed tag", "v1");
    const [commit = "", tag = "", unsigned = ""] = (
      await git("rev-parse", "HEAD", "v1", "HEAD~1")
    ).split("\n");
    const allowed = join(home, "allowed signers");
    const allow = async (key: string) =>
      writeFile(
        allowed,
        `${signer} namespaces="git" ${await readFile(join(home, `${key}.pub`), "utf8")}`,
      );

    const withoutAllowedSigners = await verify("commit", commit);
    await allow("other");
    await git("config", "--global", "gpg.ssh.allowedSignersFile", allowed);
    const otherKey = await verify("commit", commit);
    await allow("signer");
    const signedCommit = await verify("commit", commit);
    const signedTag = await verify("tag", tag);
    const unsignedCommit = await verify("commit", unsigned);

    expect(withoutAllowedSigners).toEqual({
      _tag: "CantCheck",
      reason: "AllowedSignersMissing",
    });
    expect(otherKey).toMatchObject({
      _tag: "UnknownKey",
      reason: "NotAllowedSigner",
      key: expect.stringMatching(/^SHA256:/),
    });
    expect(signedCommit).toMatchObject({
      _tag: "Verified",
      signer,
      key: expect.stringMatching(/^SHA256:/),
    });
    expect(signedTag).toMatchObject({ _tag: "Verified", signer });
    expect(unsignedCommit).toEqual({ _tag: "Unsigned" });
  });
});

async function fixture() {
  const { environment, home, env } =
    await openIsolatedTestEnvironment("rebase signatures ");
  const repository = join(home, "repository");
  await createRepository(repository);
  const repositoryId = (await environment.remember(repository)).id;
  const routes = environment.routes(SignatureVerificationApi);
  return {
    home,
    git: async (...args: string[]) =>
      (
        await exec(
          "git",
          [
            "-C",
            repository,
            "-c",
            "user.name=Rebase test",
            "-c",
            `user.email=${signer}`,
            ...args,
          ],
          {
            env,
          },
        )
      ).stdout.trim(),
    verify: (kind: "commit" | "tag", object: string) =>
      Effect.runPromise(
        routes.verify({ repositoryId, worktreePath: repository, kind, object }),
      ),
  };
}
