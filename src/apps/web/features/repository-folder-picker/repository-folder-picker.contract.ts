import type { EnvironmentDirectory } from "@rebase/contracts";
import type { TablerIcon } from "@tabler/icons-react";
import type { EnvironmentAvailability } from "#web/features/project-navigation/project-navigation.contract";

export interface RepositoryFolderPickerEnvironment {
  readonly availability: EnvironmentAvailability;
  readonly icon: TablerIcon;
  readonly iconColor: string;
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface RepositoryFolderPickerProps {
  readonly environments: readonly RepositoryFolderPickerEnvironment[];
  readonly listDirectory: (
    environmentId: string,
    path?: string,
  ) => Promise<EnvironmentDirectory>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenRepository: (
    environmentId: string,
    path: string,
  ) => Promise<void>;
  readonly open: boolean;
}
