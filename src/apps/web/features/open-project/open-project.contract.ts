import type { TablerIcon } from "@tabler/icons-react";
import type { EnvironmentAvailability } from "#web/features/project-navigation/project-navigation.contract";

export interface OpenProjectRepository {
  readonly environmentId: string;
  readonly id: string;
  readonly lastOpenedAt?: string;
  readonly name: string;
  readonly path: string;
}

export interface OpenProjectEnvironment {
  readonly availability: EnvironmentAvailability;
  readonly icon: TablerIcon;
  readonly iconColor: string;
  readonly id: string;
  readonly name: string;
  readonly repositories: readonly OpenProjectRepository[];
  readonly status: string;
}

export interface OpenProjectScreenProps {
  readonly active: boolean;
  readonly browseAvailable: boolean;
  readonly environments: readonly OpenProjectEnvironment[];
  readonly expandedEnvironmentIds: ReadonlySet<string>;
  readonly onBrowse: () => void;
  readonly onEnvironmentOpenChange: (
    environmentId: string,
    open: boolean,
  ) => void;
  readonly onOpenSettings: (repository: OpenProjectRepository) => void;
  readonly onOpenRepository: (repository: OpenProjectRepository) => void;
}
