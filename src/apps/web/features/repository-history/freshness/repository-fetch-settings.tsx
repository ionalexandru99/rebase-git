import type { RepositoryFetchSetting } from "@rebase/contracts";
import { type FormEvent, useId, useState } from "react";
import { describeRepositoryFetchError } from "#web/features/repository-history/freshness/repository-fetch-error";
import type { RepositoryHistoryReader } from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";

export function RepositoryFetchSettings({
  reader,
  setting,
  defaultIntervalSeconds,
  disabled,
  onSaved,
}: {
  readonly reader: RepositoryHistoryReader;
  readonly setting: RepositoryFetchSetting;
  readonly defaultIntervalSeconds: number;
  readonly disabled: boolean;
  readonly onSaved: () => void;
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
          onSaved();
        },
        (cause: unknown) => setError(describeRepositoryFetchError(cause)),
      )
      .finally(() => setSaving(false));
  };
  return (
    <form onSubmit={save}>
      <fieldset
        className="m-0 space-y-3 border-0 p-0"
        disabled={disabled || saving}
      >
        <legend className="mb-2 text-sm font-medium">Automatic fetch</legend>
        <p className="m-0 text-xs text-muted-foreground">
          Applies to this repository in every open client.
        </p>
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={mode === "Inherit"}
            className="accent-primary"
            name={id}
            onChange={() => setDraft({ mode: "Inherit", seconds })}
            type="radio"
            value="Inherit"
          />
          Use server default ({formatFetchInterval(defaultIntervalSeconds)})
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={mode === "Disabled"}
            className="accent-primary"
            name={id}
            onChange={() => setDraft({ mode: "Disabled", seconds })}
            type="radio"
            value="Disabled"
          />
          Off
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={mode === "Interval"}
            className="accent-primary"
            name={id}
            onChange={() => setDraft({ mode: "Interval", seconds })}
            type="radio"
            value="Interval"
          />
          Custom interval
        </label>
        {mode === "Interval" ? (
          <label className="block space-y-1 text-xs" htmlFor={`${id}-interval`}>
            <span>Interval in seconds</span>
            <Input
              aria-describedby={error === undefined ? undefined : `${id}-error`}
              aria-invalid={error !== undefined}
              id={`${id}-interval`}
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
          </label>
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
          Connect with repository write access to change fetch settings.
        </p>
      ) : null}
      <div className="mt-4 flex justify-end">
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
