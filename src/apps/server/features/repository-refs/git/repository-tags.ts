import { Effect } from "effect";
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
  isGitRejection,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  readRefTarget,
  refCommand,
  requireValidRefName,
} from "#server/features/repository-refs/git/ref-git.ts";

const pushCommand = { literalPathspecs: false, timeoutMilliseconds: 120_000 };

export function createTag(
  git: GitCommandRunner,
  { name, target, message, worktreePath }: CreateRepositoryTag,
): Effect.Effect<RepositoryTag, TagRejected | RepositoryRejected | GitFailed> {
  return Effect.gen(function* () {
    yield* requireValidTagName(git, worktreePath, name);
    if (message === undefined) {
      yield* requireUnsignedTagsAllowed(git, worktreePath);
      yield* runRepositoryGit(
        git,
        worktreePath,
        ["tag", "--no-sign", name, target],
        refCommand,
      ).pipe(Effect.mapError(tagWriteFailed));
      return { name, target };
    }
    yield* runRepositoryGit(
      git,
      worktreePath,
      ["tag", "--annotate", "--file=-", name, target],
      { ...refCommand, input: message },
    ).pipe(Effect.mapError(tagWriteFailed));
    const object = yield* readRefTarget(git, worktreePath, tagRef(name));
    return object === undefined ? { name, target } : { name, target, object };
  });
}

export function deleteTag(
  git: GitCommandRunner,
  { name, local, remote, worktreePath }: DeleteRepositoryTag,
): Effect.Effect<RepositoryTagDeleted, RefMissing | TagRejected | GitFailed> {
  return Effect.gen(function* () {
    if (local !== undefined) yield* requireTagObject(git, worktreePath, name);
    if (remote !== undefined)
      yield* runRepositoryGit(
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
      ).pipe(
        Effect.catchIf(
          (error) => isGitRejection(error) && /stale info/.test(error.detail),
          () => Effect.fail(tagRejected("RemoteDiffers")),
        ),
      );
    if (local !== undefined)
      yield* runRepositoryGit(
        git,
        worktreePath,
        ["update-ref", "-d", tagRef(name), local.object],
        refCommand,
      ).pipe(
        Effect.catchIf(isGitRejection, () => Effect.fail(tagRejected("Moved"))),
      );
    return { name };
  });
}

export function readTagAnnotation(
  git: GitCommandRunner,
  { name, worktreePath }: ReadRepositoryTag,
): Effect.Effect<RepositoryTagAnnotation, RefMissing | GitFailed> {
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
  return runRepositoryGit(
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
  ).pipe(
    Effect.flatMap((output) => {
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
        return Effect.fail<RefMissing>({ _tag: "RefMissing", name });
      return Effect.succeed({
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
      });
    }),
  );
}

function requireValidTagName(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  const invalid = tagRejected("InvalidName");
  if (name.startsWith("-")) return Effect.fail(invalid);
  return requireValidRefName(git, directory, tagRef(name), invalid);
}

function requireUnsignedTagsAllowed(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    ["config", "--type=bool", "--get", "tag.gpgSign"],
    { ...refCommand, exitCodes: [0, 1] },
  ).pipe(
    Effect.flatMap((value) =>
      value.trim() === "true"
        ? Effect.fail(tagRejected("MessageRequired"))
        : Effect.void,
    ),
  );
}

function requireTagObject(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  return readRefTarget(git, directory, tagRef(name)).pipe(
    Effect.flatMap((object) =>
      object === undefined
        ? Effect.fail<RefMissing>({ _tag: "RefMissing", name })
        : Effect.void,
    ),
  );
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
    : repositoryRejected("GitFailed", error.detail);
}
