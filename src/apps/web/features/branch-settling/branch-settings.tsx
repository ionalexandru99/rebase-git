import { useId } from "react";
import { BranchSettlingApi } from "#contracts/branch-settling/branch-settling.contract.ts";
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
          checked={settings.data?.autoSettle ?? true}
          disabled={
            settings.data === undefined ||
            !canConfigure ||
            !save.canRun ||
            save.running
          }
          onCheckedChange={(autoSettle) =>
            void save
              .run({ autoSettle })
              .then((result) =>
                errorToast.failure("saveBranchSettings", result),
              )
          }
        />
      </SettingsRow>
    </SettingsSection>
  );
}
