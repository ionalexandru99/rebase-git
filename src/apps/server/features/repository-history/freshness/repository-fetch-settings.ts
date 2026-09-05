import type { RepositoryFetchSetting } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";

const settingKey = "rebase.autoFetchIntervalSeconds";

export function readRepositoryFetchSetting(
  git: GitCommandRunner,
  path: string,
) {
  return git
    .run({
      directory: path,
      arguments: ["config", "--local", "--get", settingKey],
    })
    .pipe(
      Effect.flatMap((output) => {
        if (output.exitCode !== 0 && output.exitCode !== 1)
          return Effect.fail(settingsError());
        const value = output.stdout.trim();
        const seconds = Number(value);
        const setting: RepositoryFetchSetting =
          value === "0"
            ? { _tag: "Disabled" }
            : Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400
              ? { _tag: "Interval", seconds }
              : { _tag: "Inherit" };
        return Effect.succeed(setting);
      }),
      Effect.mapError(() => settingsError()),
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
  return git
    .run({
      directory: path,
      arguments: ["config", "--local", settingKey, value],
    })
    .pipe(
      Effect.flatMap((output) =>
        output.exitCode === 0 ? Effect.void : Effect.fail(settingsError()),
      ),
      Effect.mapError(() => settingsError()),
    );
}

function settingsError() {
  return new RepositoryHistoryError({
    failure: {
      _tag: "GitFailed",
      reason: "Failed",
      detail: "Could not access repository fetch settings",
    },
  });
}
