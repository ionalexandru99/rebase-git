import {
  type LocalBranch,
  maximumJsonMessageBytes,
  type RepositoryRefs,
  type RepositoryWorktree,
} from "@rebase/contracts";
import { Effect } from "effect";
import {
  type GitCommandRunner,
  type GitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import {
  forEachRefFormat,
  localBranchFromRecord,
  parseForEachRef,
  remoteBranchFromRecord,
  remoteDefaultBranchFromRecord,
  tagFromRecord,
} from "#server/features/repository-refs/git/parse-for-each-ref";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/repository-access";

const readTimeoutMilliseconds = 15_000;
const maximumRefsOutputBytes = 16 * 1_048_576;

export function readRepositoryRefs(
  git: GitCommandRunner,
  repository: {
    readonly id: string;
    readonly logicalRepositoryId?: string;
    readonly path: string;
  },
): Effect.Effect<RepositoryRefs, GitFailed> {
  return Effect.gen(function* () {
    const output = yield* Effect.all(
      {
        branches: listRefs(
          git,
          repository.path,
          "refs/heads",
          "-committerdate",
        ),
        remoteBranches: listRefs(
          git,
          repository.path,
          "refs/remotes",
          "refname",
        ),
        tags: listRefs(git, repository.path, "refs/tags", "-creatordate"),
        worktrees: readWorktrees(git, repository.path),
        remoteMetadata: readRemoteMetadata(git, repository.path),
      },
      { concurrency: "unbounded" },
    );
    const worktrees = yield* canonicalizeWorktrees(output.worktrees);
    return fitRepositoryRefs({
      remoteProviders: output.remoteMetadata.remoteProviders,
      ...(output.remoteMetadata.githubRepository === undefined
        ? {}
        : { githubRepository: output.remoteMetadata.githubRepository }),
      branches: canonicalizeBranchWorktrees(
        output.branches.flatMap(withDefined(localBranchFromRecord)),
        output.worktrees,
        worktrees,
      ),
      logicalRepositoryId: repository.logicalRepositoryId ?? repository.id,
      remoteBranches: output.remoteBranches.flatMap(
        withDefined(remoteBranchFromRecord),
      ),
      remoteDefaultBranches: output.remoteBranches.flatMap(
        withDefined(remoteDefaultBranchFromRecord),
      ),
      repositoryId: repository.id,
      tags: output.tags.flatMap(withDefined(tagFromRecord)),
      truncated: { branches: false, remoteBranches: false, tags: false },
      worktrees,
    });
  });
}

function listRefs(
  git: GitCommandRunner,
  directory: string,
  pattern: string,
  sort: string,
) {
  return runRepositoryGit(
    git,
    directory,
    ["for-each-ref", `--format=${forEachRefFormat}`, `--sort=${sort}`, pattern],
    {
      maxOutputBytes: maximumRefsOutputBytes,
      timeoutMilliseconds: readTimeoutMilliseconds,
    },
  ).pipe(Effect.map(parseForEachRef));
}

function canonicalizeBranchWorktrees(
  branches: readonly LocalBranch[],
  rawWorktrees: readonly RepositoryWorktree[],
  canonicalWorktrees: readonly RepositoryWorktree[],
) {
  const canonicalByRawPath = new Map(
    rawWorktrees.map((worktree, index) => [
      worktree.path,
      canonicalWorktrees[index]?.path ?? worktree.path,
    ]),
  );
  return branches.map((branch) =>
    branch.worktreePath === undefined
      ? branch
      : {
          ...branch,
          worktreePath:
            canonicalByRawPath.get(branch.worktreePath) ?? branch.worktreePath,
        },
  );
}

function withDefined<Input, Output>(
  convert: (input: Input) => Output | undefined,
) {
  return (input: Input) => {
    const output = convert(input);
    return output === undefined ? [] : [output];
  };
}

function readRemoteMetadata(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    ["config", "--get-regexp", "^remote\\..*\\.url$"],
    { timeoutMilliseconds: 5_000, maxOutputBytes: 65_536 },
  ).pipe(
    Effect.map((remotes) => ({
      githubRepository: githubRepositoryFromRemotes(remotes),
      remoteProviders: remoteProvidersFromConfig(remotes),
    })),
    Effect.catch(() =>
      Effect.succeed({ githubRepository: undefined, remoteProviders: [] }),
    ),
  );
}

export function githubRepositoryFromRemotes(
  output: string,
): RepositoryRefs["githubRepository"] {
  const remotes = output
    .trim()
    .split("\n")
    .flatMap((line) => {
      const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
      return match?.[1] === undefined || match[2] === undefined
        ? []
        : [{ remote: match[1], url: match[2] }];
    });
  const origin = remotes.find((remote) => remote.remote === "origin");
  const url =
    origin?.url ?? (remotes.length === 1 ? remotes[0]?.url : undefined);
  if (url === undefined) return undefined;
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-zA-Z0-9-]{1,39})\/([a-zA-Z0-9_.-]{1,100}?)\/?$/.exec(
      url,
    );
  const owner = match?.[1];
  const name = match?.[2]?.replace(/\.git$/, "");
  return owner === undefined ||
    name === undefined ||
    name === "" ||
    name === "." ||
    name === ".."
    ? undefined
    : { owner, name };
}

type Provider = NonNullable<
  RepositoryRefs["remoteProviders"]
>[number]["provider"];

export function remoteProvidersFromConfig(
  output: string,
): NonNullable<RepositoryRefs["remoteProviders"]> {
  const remotes = new Map<string, Provider>();
  for (const line of output.split("\n")) {
    const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
    const remote = match?.[1];
    const address = match?.[2];
    if (
      remote === undefined ||
      remote.length > 255 ||
      address === undefined ||
      remotes.has(remote)
    )
      continue;
    remotes.set(remote, providerForAddress(address));
    if (remotes.size === 256) break;
  }
  return [...remotes].map(([remote, provider]) => ({ remote, provider }));
}

function providerForAddress(address: string): Provider {
  let host: string;
  try {
    host = address.includes("://")
      ? new URL(address).hostname.toLowerCase()
      : (/^(?:[^@/]+@)?([^/:]+):/.exec(address)?.[1]?.toLowerCase() ?? "");
  } catch {
    return "git";
  }
  if (host === "github.com" || host === "ssh.github.com") return "github";
  if (host === "gitlab.com" || host === "altssh.gitlab.com") return "gitlab";
  if (host === "bitbucket.org" || host === "altssh.bitbucket.org")
    return "bitbucket";
  if (
    host === "dev.azure.com" ||
    host === "ssh.dev.azure.com" ||
    host.endsWith(".visualstudio.com")
  )
    return "azure";
  if (host === "codeberg.org") return "codeberg";
  if (/^git-codecommit\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(host))
    return "aws";
  const label = host.split(".")[0];
  if (
    label === "gitlab" ||
    label === "gitea" ||
    label === "forgejo" ||
    label === "bitbucket"
  )
    return label;
  return "git";
}

const responseSizeMargin = 512;

export function fitRepositoryRefs(refs: RepositoryRefs): RepositoryRefs {
  const budget = maximumJsonMessageBytes - responseSizeMargin;
  const emptied: RepositoryRefs = {
    ...refs,
    branches: [],
    remoteBranches: [],
    tags: [],
    truncated: { branches: true, remoteBranches: true, tags: true },
  };
  let encodedBytes = Buffer.byteLength(JSON.stringify(emptied));
  const fit = <Entry>(entries: readonly Entry[]) => {
    const fitted: Entry[] = [];
    for (const entry of entries) {
      const entryBytes =
        Buffer.byteLength(JSON.stringify(entry)) +
        (fitted.length === 0 ? 0 : 1);
      if (encodedBytes + entryBytes > budget) break;
      fitted.push(entry);
      encodedBytes += entryBytes;
    }
    return fitted;
  };

  const branches = fit(refs.branches.slice(0, 10_000));
  const remoteBranches = fit(refs.remoteBranches.slice(0, 20_000));
  const tags = fit(refs.tags.slice(0, 10_000));
  return {
    ...refs,
    branches,
    remoteBranches,
    tags,
    truncated: {
      branches: branches.length < refs.branches.length,
      remoteBranches: remoteBranches.length < refs.remoteBranches.length,
      tags: tags.length < refs.tags.length,
    },
  };
}
