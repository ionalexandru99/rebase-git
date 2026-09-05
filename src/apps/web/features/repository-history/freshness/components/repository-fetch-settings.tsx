import type { RepositoryFetchSetting } from "@rebase/contracts";
import { type FormEvent, useId, useState } from "react";
import { describeRepositoryFetchError } from "#web/features/repository-history/freshness/repository-fetch-error";
import type { RepositoryHistoryReader } from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";
import { SettingsRow } from "#web-ui/features/settings/components/settings-layout";

export function RepositoryFetchSettings({
  reader,
  setting,
  defaultIntervalSeconds,
  disabled,
  disabledReason,
  onSaved,
}: {
  readonly reader: Pick<RepositoryHistoryReader, "configureFetch">;
  readonly setting: RepositoryFetchSetting;
  readonly defaultIntervalSeconds: number;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly onSaved?: () => void;
}) {
  const id = useId();
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
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || saving) return;
    const interval = Number(seconds);
    if (
      mode === "Interval" &&
      (!Number.isInteger(interval) || interval < 1 || interval > 86_400)
    ) {
      setError("Enter a whole number from 1 to 86400 seconds.");
      return;
    }
    const next: RepositoryFetchSetting =
      mode === "Interval"
        ? { _tag: "Interval", seconds: interval }
        : { _tag: mode };
    setSaving(true);
    setError(undefined);
    void reader
      .configureFetch(next)
      .then(
        () => {
          setDraft(undefined);
          onSaved?.();
        },
        (cause: unknown) => setError(describeRepositoryFetchError(cause)),
      )
      .finally(() => setSaving(false));
  };
  return (
    <form onSubmit={save}>
      <fieldset className="m-0 border-0 p-0" disabled={disabled || saving}>
        <SettingsRow
          title="Automatic fetch"
          description="Shared by clients connected to this repository."
        >
          <select
            aria-label="Automatic fetch"
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
          <SettingsRow
            title="Custom interval"
            description="Fetch every 1 to 86,400 seconds."
          >
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
      {disabled ? (
        <p className="mt-3 mb-0 text-xs text-muted-foreground">
          {disabledReason ?? "Fetch settings are unavailable."}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end px-4">
        <Button
          disabled={disabled || saving}
          size="sm"
          type="submit"
          variant="outline"
        >
          {saving ? "Saving" : "Save"}
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
