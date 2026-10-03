import {
  PullStrategy,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { SettingsRow } from "#web/components/ui/settings-layout.tsx";
import { SettingsSelect } from "#web/components/ui/settings-select.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

const title = "Diverged pull";
const strategyLabels: Record<PullStrategy, string> = {
  ask: "Ask",
  rebase: "Rebase",
  merge: "Merge",
};
const strategyOptions = PullStrategy.literals.map((value) => ({
  label: strategyLabels[value],
  value,
}));

export function ServerPullStrategyRow() {
  const strategy = useEnvironmentQuery(
    RepositoryPullApi.readPullStrategy,
    undefined,
    { changes: "refs" },
  );
  const save = useCommand(RepositoryPullApi.savePullStrategy, {
    answers: (value) => [
      answer(RepositoryPullApi.readPullStrategy, undefined, value),
    ],
  });
  const errorToast = useErrorToast();
  const value =
    save.running && save.input !== undefined
      ? save.input.strategy
      : strategy.data;
  return (
    <SettingsRow
      title={title}
      {...(strategy.error === null
        ? {}
        : { description: describeFailure(strategy.error) })}
    >
      {value === undefined ? null : (
        <SettingsSelect
          disabled={!save.canRun || save.running}
          label={title}
          onValueChange={async (next) =>
            errorToast.failure(
              "savePullStrategy",
              await save.run({ strategy: next }),
            )
          }
          options={strategyOptions}
          value={value}
        />
      )}
    </SettingsRow>
  );
}

export function RepositoryPullStrategyRow({
  repositoryId,
}: {
  readonly repositoryId: string;
}) {
  const strategy = useEnvironmentQuery(
    RepositoryPullApi.readRepositoryPullStrategy,
    { repositoryId },
    { changes: "refs" },
  );
  const save = useCommand(RepositoryPullApi.saveRepositoryPullStrategy, {
    answers: (value) => [
      answer(
        RepositoryPullApi.readRepositoryPullStrategy,
        { repositoryId },
        value,
      ),
    ],
  });
  const errorToast = useErrorToast();
  const data = strategy.data;
  const repository =
    save.running && save.input !== undefined
      ? save.input.strategy
      : data?.repository;
  return (
    <SettingsRow
      title={title}
      {...(strategy.error === null
        ? {}
        : { description: describeFailure(strategy.error) })}
    >
      {data === undefined ? null : (
        <SettingsSelect
          disabled={!save.canRun || save.running}
          label={title}
          onValueChange={async (next) =>
            errorToast.failure(
              "savePullStrategy",
              await save.run({
                repositoryId,
                strategy: next === "default" ? null : next,
              }),
            )
          }
          options={[
            {
              label: `Default (${strategyLabels[data.server]})`,
              value: "default" as const,
            },
            ...strategyOptions,
          ]}
          value={repository ?? "default"}
        />
      )}
    </SettingsRow>
  );
}
