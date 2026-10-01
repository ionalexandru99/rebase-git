import { type FormEvent, useId, useState } from "react";
import {
  type RepositoryFetchSetting,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { SettingsRow } from "#web/components/ui/settings-layout.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

const inheritedSetting: RepositoryFetchSetting = { _tag: "Inherit" };

export function RepositoryFetchSettings({
  repositoryId,
  canConfigure,
}: {
  readonly repositoryId: string;
  readonly canConfigure: boolean;
}) {
  const id = useId();
  const status = useEnvironmentQuery(
    RepositoryPullApi.fetchStatus,
    { repositoryId },
    { changes: "refs" },
  );
  const configure = useCommand(RepositoryPullApi.configureFetch);
  const setting = status.data?.setting ?? inheritedSetting;
  const defaultIntervalSeconds = status.data?.defaultIntervalSeconds ?? 300;
  const disabled =
    !configure.canRun || !canConfigure || status.data === undefined;
  const disabledReason = !configure.canRun
    ? "Reconnect to change fetch settings."
    : status.error !== null
      ? describeFailure(status.error)
      : !canConfigure
        ? "Connect with repository write access to change fetch settings."
        : undefined;
  const [draft, setDraft] = useState<{
    readonly mode: RepositoryFetchSetting["_tag"];
    readonly seconds: string;
  }>();
  const mode = draft?.mode ?? setting._tag;
  const seconds =
    draft?.seconds ??
    String(
      setting._tag === "Interval" ? setting.seconds : defaultIntervalSeconds,
    );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const errorToast = useErrorToast();
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || saving) return;
    const interval = Number(seconds);
    if (
      mode === "Interval" &&
      (!Number.isInteger(interval) || interval < 1 || interval > 86_400)
    ) {
      setError("Enter a whole number from 1 to 86,400.");
      return;
    }
    const next: RepositoryFetchSetting =
      mode === "Interval"
        ? { _tag: "Interval", seconds: interval }
        : { _tag: mode };
    setSaving(true);
    setError(undefined);
    void configure
      .run({ repositoryId, setting: next })
      .then((result) => {
        if (result._tag === "Ok") setDraft(undefined);
        else errorToast.failure("saveFetchSettings", result);
      })
      .finally(() => setSaving(false));
  };
  return (
    <form onSubmit={save}>
      <fieldset className="m-0 border-0 p-0" disabled={disabled || saving}>
        <SettingsRow
          title="Automatic fetch"
          description="Shared by clients connected to this repository."
          descriptionId={`${id}-scope`}
        >
          <select
            aria-label="Automatic fetch"
            aria-describedby={`${id}-scope`}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            value={mode}
            onChange={(event) => {
              const mode = event.currentTarget.value;
              if (
                mode === "Inherit" ||
                mode === "Disabled" ||
                mode === "Interval"
              )
                setDraft({ mode, seconds });
            }}
          >
            <option value="Inherit">
              Server default · {formatFetchInterval(defaultIntervalSeconds)}
            </option>
            <option value="Disabled">Off</option>
            <option value="Interval">Custom interval</option>
          </select>
        </SettingsRow>
        {mode === "Interval" ? (
          <SettingsRow title="Interval in seconds">
            <Input
              aria-label="Interval in seconds"
              aria-describedby={error === undefined ? undefined : `${id}-error`}
              aria-invalid={error !== undefined}
              className="w-32"
              max={86_400}
              min={1}
              onChange={(event) =>
                setDraft({ mode, seconds: event.target.value })
              }
              required
              step={1}
              type="number"
              value={seconds}
            />
          </SettingsRow>
        ) : null}
      </fieldset>
      {error === undefined ? null : (
        <p
          className="mt-3 mb-0 text-xs text-destructive"
          id={`${id}-error`}
          role="alert"
        >
          {error}
        </p>
      )}
      {disabled && disabledReason !== undefined ? (
        <p className="mt-3 mb-0 text-xs text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end px-4">
        <Button
          disabled={disabled || saving}
          size="sm"
          type="submit"
          variant="outline"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function formatFetchInterval(seconds: number) {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}
