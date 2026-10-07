import { useId, useState } from "react";
import {
  BranchSettlingApi,
  defaultDeleteSettledAfter,
  type BranchSettings as Settings,
} from "#contracts/branch-settling/branch-settling.contract.ts";
import { Input } from "#web/components/ui/input.tsx";
import {
  SettingsRow,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export function BranchSettings({
  repositoryId,
  path,
  canConfigure,
}: {
  readonly repositoryId: string;
  readonly path: string;
  readonly canConfigure: boolean;
}) {
  const target = { repositoryId, worktreePath: path };
  const settings = useEnvironmentQuery(BranchSettlingApi.settings, target, {
    changes: "refs",
  });
  const save = useCommand(BranchSettlingApi.saveSettings, {
    target,
    answers: (value) => [answer(BranchSettlingApi.settings, target, value)],
  });
  const errorToast = useErrorToast();
  const descriptionId = useId();
  const current = settings.data;
  const disabled =
    current === undefined || !canConfigure || !save.canRun || save.running;
  const apply = async (next: Partial<Settings>) => {
    if (current === undefined) return;
    errorToast.failure(
      "saveBranchSettings",
      await save.run({ ...current, ...next }),
    );
  };
  return (
    <SettingsSection title="Branches">
      <SettingsRow
        title="Settle merged branches"
        description={
          settings.error === null
            ? "Move a branch to Settled once its pull request merges."
            : describeFailure(settings.error)
        }
        descriptionId={descriptionId}
      >
        <Switch
          aria-describedby={descriptionId}
          aria-label="Settle merged branches"
          checked={current?.autoSettle ?? true}
          disabled={disabled}
          onCheckedChange={(autoSettle) => void apply({ autoSettle })}
        />
      </SettingsRow>
      <SettledDeletionRow
        days={current?.deleteSettledAfter}
        disabled={disabled}
        save={(deleteSettledAfter) => apply({ deleteSettledAfter })}
      />
    </SettingsSection>
  );
}

function SettledDeletionRow({
  days,
  disabled,
  save,
}: {
  readonly days: number | undefined;
  readonly disabled: boolean;
  readonly save: (days: number) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const enabled = days === undefined || days > 0;
  const shown =
    draft ??
    String(days === undefined || days === 0 ? defaultDeleteSettledAfter : days);
  const parsed = Number(shown);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 365;
  const store = (next: number) => {
    setInvalid(false);
    void save(next).finally(() => setDraft(undefined));
  };
  const commit = () => {
    if (draft === undefined) return;
    if (!valid) setInvalid(true);
    else if (parsed === days) setDraft(undefined);
    else store(parsed);
  };
  return (
    <SettingsRow
      title="Delete settled branches"
      description={
        <>
          <span id={`${id}-description`}>
            Their worktrees go too. Locked worktrees, uncommitted changes and
            commits found on no other branch are kept.
          </span>
          {invalid ? (
            <span
              className="block text-destructive"
              id={`${id}-error`}
              role="alert"
            >
              Enter a whole number from 1 to 365.
            </span>
          ) : null}
        </>
      }
    >
      <span className="text-control text-muted-foreground">After</span>
      <Input
        aria-describedby={invalid ? `${id}-error` : undefined}
        aria-invalid={invalid}
        aria-label="Days before deleting settled branches"
        className="w-14 text-center"
        disabled={disabled || !enabled}
        max={365}
        min={1}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        step={1}
        type="number"
        value={shown}
      />
      <span className="text-control text-muted-foreground">days</span>
      <Switch
        aria-describedby={`${id}-description`}
        aria-label="Delete settled branches"
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(on) =>
          store(on ? (valid ? parsed : defaultDeleteSettledAfter) : 0)
        }
      />
    </SettingsRow>
  );
}
