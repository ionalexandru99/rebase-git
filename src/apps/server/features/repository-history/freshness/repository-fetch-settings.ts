import type { RepositoryFetchSetting } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { runRepositoryGit } from "#server/repository/access/index";

const settingKey = "rebase.autoFetchIntervalSeconds";

export function readRepositoryFetchSetting(
  git: GitCommandRunner,
  path: string,
) {
  return runRepositoryGit(
    git,
    path,
    ["config", "--local", "--get", settingKey],
    { exitCodes: [0, 1] },
  ).pipe(
    Effect.map((output): RepositoryFetchSetting => {
      const value = output.trim();
      const seconds = Number(value);
      return value === "0"
        ? { _tag: "Disabled" }
        : Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400
          ? { _tag: "Interval", seconds }
          : { _tag: "Inherit" };
    }),
    Effect.mapError(settingsError),
  );
}

export function writeRepositoryFetchSetting(
  git: GitCommandRunner,
  path: string,
  setting: RepositoryFetchSetting,
) {
  const value =
    setting._tag === "Disabled"
      ? "0"
      : setting._tag === "Interval"
        ? String(setting.seconds)
        : "inherit";
  return runRepositoryGit(git, path, [
    "config",
    "--local",
    settingKey,
    value,
  ]).pipe(Effect.asVoid, Effect.mapError(settingsError));
}

function settingsError(cause: RepositoryGitError) {
  return new RepositoryHistoryError({
    cause,
    failure: {
      _tag: "GitFailed",
      reason: "Failed",
      detail: "Could not access repository fetch settings",
    },
  });
}
