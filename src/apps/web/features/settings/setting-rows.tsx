import type { z } from "zod";
import type { EnvironmentRoute } from "#contracts/environment-connection/environment-route.contract.ts";
import type { SettingApi } from "#contracts/settings/setting-routes.contract.ts";
import { SettingsRow } from "#web/components/ui/settings-layout.tsx";
import { SettingsSelect } from "#web/components/ui/settings-select.tsx";
import {
  type ErrorAction,
  useErrorToast,
} from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import {
  describeFailure,
  type RequestFailure,
  type TaggedFailure,
} from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

type SettingRoute<Input, Value> = EnvironmentRoute<
  string,
  z.ZodType<Input>,
  z.ZodType<Value>,
  z.ZodType<TaggedFailure>
>;

export function useSetting<Input, Value, Choice>(
  read: SettingRoute<Input, Value>,
  input: Input,
  save: SettingRoute<{ readonly value: Choice }, Value>,
) {
  const query = useEnvironmentQuery(read, input, { changes: "refs" });
  const command = useCommand(save, {
    answers: (value) => [answer(read, input, value)],
  });
  return {
    data: query.data,
    error: query.error === null ? undefined : describeFailure(query.error),
    busy: !command.canRun || command.running,
    pending:
      command.running && command.input !== undefined
        ? { value: command.input.value }
        : undefined,
    save: (value: Choice) => command.run({ ...input, value }),
    saveError:
      command.failure === undefined
        ? undefined
        : describeFailure(command.failure),
    reset: command.reset,
  };
}

export interface SelectSetting<Value extends string | boolean> {
  readonly title: string;
  readonly action: ErrorAction;
  readonly api: SettingApi<
    Value,
    Value,
    { readonly repository: Value | null; readonly server: Value }
  >;
  readonly choices: readonly {
    readonly label: string;
    readonly value: Value;
  }[];
}

export function ServerSettingSelect<Value extends string | boolean>({
  setting,
}: {
  readonly setting: SelectSetting<Value>;
}) {
  const { api, title, action, choices } = setting;
  const state = useSetting(api.read, undefined, api.save);
  return (
    <SettingSelectRow
      action={action}
      choices={choices}
      state={state}
      title={title}
      value={state.pending === undefined ? state.data : state.pending.value}
    />
  );
}

export function RepositorySettingSelect<Value extends string | boolean>({
  setting,
  repositoryId,
}: {
  readonly setting: SelectSetting<Value>;
  readonly repositoryId: string;
}) {
  const { api, title, action, choices } = setting;
  const state = useSetting(
    api.readRepository,
    { repositoryId },
    api.saveRepository,
  );
  const data = state.data;
  const server = choices.find((choice) => choice.value === data?.server);
  return (
    <SettingSelectRow
      action={action}
      choices={[
        { label: `Default (${server?.label})`, value: null },
        ...choices,
      ]}
      state={state}
      title={title}
      value={
        data === undefined
          ? undefined
          : state.pending === undefined
            ? data.repository
            : state.pending.value
      }
    />
  );
}

function SettingSelectRow<Choice extends string | boolean | null>({
  title,
  action,
  choices,
  value,
  state,
}: {
  readonly title: string;
  readonly action: ErrorAction;
  readonly choices: readonly {
    readonly label: string;
    readonly value: Choice;
  }[];
  readonly value: Choice | undefined;
  readonly state: {
    readonly busy: boolean;
    readonly error: string | undefined;
    readonly save: (
      choice: Choice,
    ) => Promise<{ readonly _tag: "Ok" } | RequestFailure<TaggedFailure>>;
  };
}) {
  const errorToast = useErrorToast();
  return (
    <SettingsRow description={state.error} title={title}>
      {value === undefined ? null : (
        <SettingsSelect
          disabled={state.busy}
          label={title}
          onValueChange={async (next) => {
            const choice = choices.find(
              (candidate) => optionKey(candidate.value) === next,
            );
            if (choice !== undefined)
              errorToast.failure(action, await state.save(choice.value));
          }}
          options={choices.map((choice) => ({
            label: choice.label,
            value: optionKey(choice.value),
          }))}
          value={optionKey(value)}
        />
      )}
    </SettingsRow>
  );
}

function optionKey(value: string | boolean | null) {
  return value === null ? "default" : String(value);
}
