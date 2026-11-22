import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import type {
  RefMissing,
  RepositoryTag,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import type {
  CreateRepositoryTag,
  DeleteRepositoryTag,
  ReadRepositoryTag,
  RepositoryTagAnnotation,
  RepositoryTagDeleted,
  TagRejected,
} from "#contracts/repository-refs/repository-tags.contract.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  isGitFailed,
  isGitRejection,
  runRepositoryGit,
  signingRejection,
} from "#server/adapters/local-git/git-commands.ts";
import {
  isGitRejected,
  readRefTarget,
  refCommand,
  requireValidRefName,
} from "#server/features/repository-refs/git/ref-git.ts";

const pushCommand = { literalPathspecs: false, timeoutMilliseconds: 120_000 };

export async function createTag(
  git: GitCommandRunner,
  { name, target, message, worktreePath }: CreateRepositoryTag,
): Promise<RepositoryTag> {
  await requireValidTagName(git, worktreePath, name);
  if (message === undefined) {
    await requireUnsignedTagsAllowed(git, worktreePath);
    await writeTag(git, worktreePath, ["tag", "--no-sign", name, target]);
    return { name, target };
  }
  await writeTag(
    git,
    worktreePath,
    ["tag", "--annotate", "--file=-", name, target],
    message,
  );
  const object = await readRefTarget(git, worktreePath, tagRef(name));
  return object === undefined ? { name, target } : { name, target, object };
}

export async function deleteTag(
  git: GitCommandRunner,
  { name, local, remote, worktreePath }: DeleteRepositoryTag,
): Promise<RepositoryTagDeleted> {
  if (local !== undefined) await requireTagObject(git, worktreePath, name);
  if (remote !== undefined)
    try {
      await runRepositoryGit(
        git,
        worktreePath,
        [
          "push",
          `--force-with-lease=${tagRef(name)}:${remote.object}`,
          remote.remote,
          "--delete",
          tagRef(name),
        ],
        pushCommand,
      );
    } catch (error) {
      throw isGitRejected(error) && /stale info/.test(error.detail)
        ? tagRejected("RemoteDiffers")
        : error;
    }
  if (local !== undefined)
    try {
      await runRepositoryGit(
        git,
        worktreePath,
        ["update-ref", "-d", tagRef(name), local.object],
        refCommand,
      );
    } catch (error) {
      throw isGitRejected(error) ? tagRejected("Moved") : error;
    }
  return { name };
}

export async function readTagAnnotation(
  git: GitCommandRunner,
  { name, worktreePath }: ReadRepositoryTag,
): Promise<RepositoryTagAnnotation> {
  const fields = [
    "%(refname)",
    "%(objecttype)",
    "%(objectname)",
    "%(*objectname)",
    "%(taggername)",
    "%(taggerdate:iso-strict)",
    "%(contents:signature)",
    "%(contents)",
  ];
  const output = await runRepositoryGit(
    git,
    worktreePath,
    [
      "for-each-ref",
      "--count=1",
      "--sort=refname",
      `--format=${fields.join("%00")}`,
      tagRef(name),
    ],
    refCommand,
  );
  const record = output.replace(/\n$/, "").split("\0");
  const [refname, type, object, target, tagger = "", date = ""] = record;
  const signature = record[6] ?? "";
  const contents = record.slice(7).join("\0");
  if (
    refname !== tagRef(name) ||
    type !== "tag" ||
    object === undefined ||
    target === undefined
  )
    throw refMissing(name);
  return {
    name,
    object,
    target,
    tagger: { name: tagger.slice(0, 512), date: date.slice(0, 64) },
    message: (contents.endsWith(signature) && signature.length > 0
      ? contents.slice(0, -signature.length)
      : contents
    )
      .trimEnd()
      .slice(0, 65_536),
    signed: signature.length > 0,
  };
}

async function requireValidTagName(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  const invalid = tagRejected("InvalidName");
  if (name.startsWith("-")) throw invalid;
  await requireValidRefName(git, directory, tagRef(name), invalid);
}

async function requireUnsignedTagsAllowed(
  git: GitCommandRunner,
  directory: string,
) {
  const value = await runRepositoryGit(
    git,
    directory,
    ["config", "--type=bool", "--get", "tag.gpgSign"],
    { ...refCommand, exitCodes: [0, 1] },
  );
  if (value.trim() === "true") throw tagRejected("MessageRequired");
}

async function requireTagObject(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  if ((await readRefTarget(git, directory, tagRef(name))) === undefined)
    throw refMissing(name);
}

async function writeTag(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  message?: string,
) {
  try {
    await runRepositoryGit(
      git,
      directory,
      args,
      message === undefined ? refCommand : { ...refCommand, input: message },
    );
  } catch (error) {
    throw isGitFailed(error) ? tagWriteFailed(error) : error;
  }
}

function refMissing(name: string): RefMissing {
  return { _tag: "RefMissing", name };
}

function tagRef(name: string) {
  return `refs/tags/${name}`;
}

function tagRejected(reason: TagRejected["reason"]): TagRejected {
  return { _tag: "TagRejected", reason };
}

function tagWriteFailed(error: GitFailed): TagRejected | RepositoryRejected {
  return isGitRejection(error) && /already exists/.test(error.detail)
    ? tagRejected("Exists")
    : (signingRejection(error.detail) ??
        repositoryRejected("GitFailed", error.detail));
}
