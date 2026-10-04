import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { SettingsRow } from "#web/components/ui/settings-layout.tsx";
import { SettingsSelect } from "#web/components/ui/settings-select.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

const title = "Remove deleted remote branches";
const pruneOptions = [
  { label: "On", value: "on" },
  { label: "Off", value: "off" },
] as const;

const onOff = (prune: boolean) => (prune ? "on" : "off");

export function ServerFetchPruneRow() {
  const prune = useEnvironmentQuery(
    RepositoryPullApi.readFetchPrune,
    undefined,
    {
      changes: "refs",
    },
  );
  const save = useCommand(RepositoryPullApi.saveFetchPrune, {
    answers: (value) => [
      answer(RepositoryPullApi.readFetchPrune, undefined, value),
    ],
  });
  const errorToast = useErrorToast();
  const value =
    save.running && save.input !== undefined ? save.input.prune : prune.data;
  return (
    <SettingsRow
      title={title}
      {...(prune.error === null
        ? {}
        : { description: describeFailure(prune.error) })}
    >
      {value === undefined ? null : (
        <SettingsSelect
          disabled={!save.canRun || save.running}
          label={title}
          onValueChange={async (next) =>
            errorToast.failure(
              "saveFetchPrune",
              await save.run({ prune: next === "on" }),
            )
          }
          options={pruneOptions}
          value={onOff(value)}
        />
      )}
    </SettingsRow>
  );
}

export function RepositoryFetchPruneRow({
  repositoryId,
}: {
  readonly repositoryId: string;
}) {
  const prune = useEnvironmentQuery(
    RepositoryPullApi.readRepositoryFetchPrune,
    { repositoryId },
    { changes: "refs" },
  );
  const save = useCommand(RepositoryPullApi.saveRepositoryFetchPrune, {
    answers: (value) => [
      answer(
        RepositoryPullApi.readRepositoryFetchPrune,
        { repositoryId },
        value,
      ),
    ],
  });
  const errorToast = useErrorToast();
  const data = prune.data;
  const repository =
    save.running && save.input !== undefined
      ? save.input.prune
      : data?.repository;
  return (
    <SettingsRow
      title={title}
      {...(prune.error === null
        ? {}
        : { description: describeFailure(prune.error) })}
    >
      {data === undefined ? null : (
        <SettingsSelect
          disabled={!save.canRun || save.running}
          label={title}
          onValueChange={async (next) =>
            errorToast.failure(
              "saveFetchPrune",
              await save.run({
                repositoryId,
                prune: next === "default" ? null : next === "on",
              }),
            )
          }
          options={[
            {
              label: `Default (${data.server ? "On" : "Off"})`,
              value: "default" as const,
            },
            ...pruneOptions,
          ]}
          value={
            repository === null || repository === undefined
              ? "default"
              : onOff(repository)
          }
        />
      )}
    </SettingsRow>
  );
}
