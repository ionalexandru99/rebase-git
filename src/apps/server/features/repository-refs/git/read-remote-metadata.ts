import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { githubRepositoryFromRemotes } from "#server/features/repository-refs/git/github-repository";
import { remoteProvidersFromConfig } from "#server/features/repository-refs/git/remote-providers";
import { runRepositoryGit } from "#server/repository/access/index";

export function readRemoteMetadata(git: GitCommandRunner, directory: string) {
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
