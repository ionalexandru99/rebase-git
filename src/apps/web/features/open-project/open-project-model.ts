import type { TablerIcon } from "@tabler/icons-react";
import type { RepositoryColor } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { EnvironmentAvailability } from "#web/platform/query/environment-context.tsx";

export interface OpenProjectRepository {
  readonly color: RepositoryColor;
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
