import { IconFolder } from "@tabler/icons-react";
import { type JSX, useState } from "react";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { SettingsRow } from "#web/components/ui/settings-layout.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { FolderPicker } from "#web/features/repository-folder-picker/repository-folder-browser.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export function CloneFolderRow(): JSX.Element {
  const defaults = useEnvironmentQuery(
    RepositoryCatalogApi.defaults,
    undefined,
    {
      changes: "none",
    },
  );
  const save = useCommand(RepositoryCatalogApi.setCloneFolder, {
    answers: (_, { path }) => [
      answer(RepositoryCatalogApi.defaults, undefined, (current) => ({
        initialBranch: current?.initialBranch ?? "main",
        cloneFolder: path,
      })),
    ],
  });
  const errorToast = useErrorToast();
  const [choosing, setChoosing] = useState(false);
  const folder =
    save.running && save.input !== undefined
      ? save.input.path
      : defaults.data?.cloneFolder;
  return (
    <SettingsRow
      title="Clone folder"
      {...(folder === undefined ? {} : { value: folder })}
    >
      <Button
        disabled={!save.canRun || save.running || folder === undefined}
        onClick={() => setChoosing(true)}
        size="sm"
        variant="outline"
      >
        <IconFolder aria-hidden="true" />
        Change
      </Button>
      <FolderPicker
        onChosen={async (path) =>
          errorToast.failure("saveCloneFolder", await save.run({ path }))
        }
        onOpenChange={setChoosing}
        open={choosing}
        title="Clone folder"
      />
    </SettingsRow>
  );
}
