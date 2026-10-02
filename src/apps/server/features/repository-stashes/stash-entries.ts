import { Effect } from "effect";
import type {
  RepositoryStash,
  RepositoryStashes,
  StashMissing,
  StashRejected,
} from "#contracts/repository-stashes/repository-stashes.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

const maximumStashes = 1_000;
const separator = "\x1f";
const autoStash = /^rebase-auto-stash:[0-9a-f-]+ before checking out (.+)$/s;

interface StashEntry {
  readonly oid: string;
  readonly subject: string;
  readonly recordedAt: number;
}

export function listStashes(git: GitCommandRunner, directory: string) {
  return Effect.gen(function* () {
    const entries = yield* readStashEntries(git, directory);
    const kept = entries.slice(0, maximumStashes);
    const staged = yield* readStagedFlags(git, directory, kept);
    return {
      stashes: kept.map(
        (entry, index): RepositoryStash => ({
          oid: entry.oid,
          ...describeStash(entry.subject),
          staged: staged[index] ?? false,
          recordedAt: entry.recordedAt,
        }),
      ),
      truncated: entries.length > maximumStashes,
    } satisfies RepositoryStashes;
  });
}

export function describeStash(subject: string) {
  const wip = /^WIP on ([^:]+): /.exec(subject);
  if (wip?.[1] !== undefined)
    return {
      name: `WIP on ${wip[1]}`,
      named: false,
      auto: false,
      branch: branchOf(wip[1]),
    };
  const on = /^On ([^:]+): (.*)$/s.exec(subject);
  if (on?.[1] === undefined || on[2] === undefined)
    return { name: subject, named: true, auto: false, branch: null };
  const checkout = autoStash.exec(on[2]);
  return {
    name:
      checkout?.[1] === undefined
        ? on[2]
        : `Before checking out ${checkout[1]}`,
    named: true,
    auto: checkout !== null,
    branch: branchOf(on[1]),
  };
}

export function requireStashIndex(
  git: GitCommandRunner,
  directory: string,
  oid: string,
) {
  return readStashEntries(git, directory).pipe(
    Effect.flatMap((entries) => {
      const index = entries.findIndex((entry) => entry.oid === oid);
      const entry = entries[index];
      return entry === undefined
        ? Effect.fail(stashMissing())
        : Effect.succeed({ index, subject: entry.subject });
    }),
  );
}

export function dropEntry(
  git: GitCommandRunner,
  directory: string,
  { index }: { readonly index: number },
) {
  return runRepositoryGit(git, directory, [
    "stash",
    "drop",
    "--quiet",
    `stash@{${index}}`,
  ]).pipe(Effect.asVoid);
}

export function stashMissing(): StashMissing {
  return { _tag: "StashMissing" };
}

export function stashRejected(reason: StashRejected["reason"]): StashRejected {
  return { _tag: "StashRejected", reason };
}

function readStashEntries(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    [
      "stash",
      "list",
      "--date=unix",
      `--max-count=${maximumStashes + 1}`,
      `--format=%H${separator}%gd${separator}%gs`,
    ],
    { maxOutputBytes: 16 * 1_048_576 },
  ).pipe(
    Effect.map((output) =>
      output
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line): StashEntry => {
          const [oid = "", selector = "", subject = ""] = line.split(separator);
          return {
            oid,
            subject,
            recordedAt: Number(/\{(\d+)\}$/.exec(selector)?.[1] ?? 0),
          };
        }),
    ),
  );
}

function readStagedFlags(
  git: GitCommandRunner,
  directory: string,
  entries: readonly StashEntry[],
) {
  if (entries.length === 0) return Effect.succeed([]);
  return runRepositoryGit(
    git,
    directory,
    ["cat-file", "--batch-check=%(objectname)"],
    {
      input: entries
        .map(({ oid }) => `${oid}^2^{tree}\n${oid}^1^{tree}\n`)
        .join(""),
      maxOutputBytes: 16 * 1_048_576,
    },
  ).pipe(
    Effect.map((output) => {
      const trees = output.split("\n");
      return entries.map(
        (_, index) => trees[index * 2] !== trees[index * 2 + 1],
      );
    }),
  );
}

function branchOf(name: string) {
  return name === "(no branch)" ? null : name;
}
