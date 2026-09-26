import type { TablerIcon } from "@tabler/icons-react";
import type { EnvironmentAvailability } from "#web/platform/query/environment-context";

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
