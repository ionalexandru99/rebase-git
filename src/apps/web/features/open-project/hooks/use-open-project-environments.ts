import { IconDeviceLaptop } from "@tabler/icons-react";
import { useMemo } from "react";
import type { OpenProjectEnvironment } from "#web/features/open-project/open-project.contract";
import { localEnvironment } from "#web/features/project-navigation/local-environment";
import { useRepositoryCatalog } from "#web/features/repository-catalog/hooks/use-repository-catalog";
import { useEnvironment } from "#web/platform/query/environment-context";

export function useOpenProjectEnvironments(): readonly OpenProjectEnvironment[] {
  const { repositories } = useRepositoryCatalog();
  const { availability, connectionState, status } = useEnvironment().status;
  return useMemo(
    () =>
      connectionState === "PairingRequired"
        ? []
        : [
            {
              availability,
              icon: IconDeviceLaptop,
              iconColor: "var(--primary)",
              id: localEnvironment.id,
              name: localEnvironment.name,
              repositories: repositories.map((repository) => ({
                environmentId: localEnvironment.id,
                id: repository.id,
                lastOpenedAt: repository.lastOpenedAt,
                name: repository.name,
                path: repository.path,
              })),
              status,
            },
          ],
    [availability, connectionState, repositories, status],
  );
}
