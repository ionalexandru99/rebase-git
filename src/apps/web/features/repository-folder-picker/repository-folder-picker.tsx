import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { type JSX, useState } from "react";
import { Dialog, DialogContent } from "#web-ui/components/ui/dialog";
import { RepositoryFolderBrowser } from "#web-ui/features/repository-folder-picker/repository-folder-browser";
import type { RepositoryFolderPickerEnvironment } from "#web-ui/features/repository-folder-picker/repository-folder-picker-environment-select";

interface RepositoryFolderPickerProps {
  readonly environments: readonly RepositoryFolderPickerEnvironment[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onRepositoryOpened: (
    environmentId: string,
    repository: RepositoryCatalogEntry,
  ) => void;
  readonly open: boolean;
}

export function RepositoryFolderPicker({
  environments,
  onOpenChange,
  onRepositoryOpened,
  open,
}: RepositoryFolderPickerProps): JSX.Element | null {
  const [environmentId, setEnvironmentId] = useState<string>();
  const environment =
    environments.find(({ id }) => id === environmentId) ??
    environments.find(({ availability }) => availability === "available") ??
    environments[0];
  if (environment === undefined) return null;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(32rem,calc(100svh-2rem))] max-w-[46rem] flex-col overflow-hidden">
        <RepositoryFolderBrowser
          key={environment.id}
          environment={environment}
          environments={environments}
          chooseEnvironment={setEnvironmentId}
          onRepositoryOpened={(repository) => {
            onRepositoryOpened(environment.id, repository);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
