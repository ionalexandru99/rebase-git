import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { githubRepositoryFromRemotes } from "#server/features/repository-refs/git/github-repository";
import { remoteProvidersFromConfig } from "#server/features/repository-refs/git/remote-providers";

export function readRemoteMetadata(git: GitCommandRunner, directory: string) {
  return git
    .run({
      arguments: ["config", "--get-regexp", "^remote\\..*\\.url$"],
      directory,
      timeoutMilliseconds: 5_000,
      maxOutputBytes: 65_536,
    })
    .pipe(
      Effect.map((result) =>
        result.exitCode === 0
          ? {
              githubRepository: githubRepositoryFromRemotes(result.stdout),
              remoteProviders: remoteProvidersFromConfig(result.stdout),
            }
          : { githubRepository: undefined, remoteProviders: [] },
      ),
      Effect.catch(() =>
        Effect.succeed({ githubRepository: undefined, remoteProviders: [] }),
      ),
    );
}
