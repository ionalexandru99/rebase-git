import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type SigningKey,
  signingKeyName,
  sshPublicKey,
} from "#contracts/git-signing/git-signing.contract.ts";
import {
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

export async function listSigningKeys(
  git: GitCommandRunner,
  directory: string,
) {
  const [files, agent, gpg] = await Promise.all([
    sshFileKeys(git, directory),
    sshAgentKeys(git, directory),
    gpgKeys(git, directory),
  ]);
  return [
    ...files,
    ...agent.filter((key) => !files.some((file) => file.blob === key.blob)),
    ...gpg,
  ].map(({ format, key, label }) => ({ format, key, label }));
}

async function sshFileKeys(git: GitCommandRunner, directory: string) {
  let folder: string;
  try {
    folder = (
      await runRepositoryGit(git, directory, [
        "-c",
        "rebase.sshdirectory=~/.ssh",
        "config",
        "--type=path",
        "--get",
        "rebase.sshdirectory",
      ])
    ).trim();
  } catch (error) {
    if (isGitFailed(error)) return [];
    throw error;
  }
  const names = await readdir(folder).catch(() => []);
  const found = await Promise.all(
    names
      .filter((name) => name.endsWith(".pub"))
      .sort()
      .map(async (name) => {
        const path = join(folder, name);
        const publicKey = sshPublicKey(
          await readFile(path, "utf8").catch(() => ""),
        );
        return publicKey === undefined
          ? []
          : [
              {
                format: "ssh" as const,
                key: path,
                label: signingKeyName(name),
                blob: publicKey.blob,
              },
            ];
      }),
  );
  return found.flat();
}

async function sshAgentKeys(git: GitCommandRunner, directory: string) {
  const output = await shell(git, directory, "ssh-add -L");
  return output.split("\n").flatMap((line) => {
    const publicKey = sshPublicKey(line);
    return publicKey === undefined
      ? []
      : [
          {
            format: "ssh" as const,
            key: `key::${publicKey.type} ${publicKey.blob}`,
            label: publicKey.comment || `…${publicKey.blob.slice(-8)}`,
            blob: publicKey.blob,
          },
        ];
  });
}

async function gpgKeys(git: GitCommandRunner, directory: string) {
  return parseGpgKeys(
    await shell(
      git,
      directory,
      '"$(git config gpg.openpgp.program || git config gpg.program || echo gpg)" --list-secret-keys --with-colons',
    ),
  );
}

async function shell(
  git: GitCommandRunner,
  directory: string,
  command: string,
) {
  try {
    return await runRepositoryGit(
      git,
      directory,
      ["-c", `alias.rebase-signing-keys=!${command}`, "rebase-signing-keys"],
      { exitCodes: [0, 1, 2, 127] },
    );
  } catch (error) {
    if (isGitFailed(error)) return "";
    throw error;
  }
}

function parseGpgKeys(output: string): readonly SigningKey[] {
  const found: SigningKey[] = [];
  let current:
    | { fingerprint?: string | undefined; email?: string | undefined }
    | undefined;
  const finish = () => {
    if (current?.fingerprint !== undefined)
      found.push({
        format: "openpgp",
        key: current.fingerprint,
        label: [current.fingerprint.slice(-8), current.email]
          .filter((part) => part !== undefined)
          .join(" · "),
      });
    current = undefined;
  };
  for (const line of output.split("\n")) {
    const fields = line.split(":");
    const [kind, validity] = fields;
    if (kind === "sec") {
      finish();
      if (!/[ider]/.test(validity ?? "") && /S/.test(fields[11] ?? ""))
        current = {};
    } else if (kind === "ssb") finish();
    else if (kind === "fpr" && current !== undefined)
      current.fingerprint ??= fields[9];
    else if (kind === "uid" && current !== undefined)
      current.email ??= /<([^>]+)>/.exec(fields[9] ?? "")?.[1];
  }
  finish();
  return found;
}
