import { RepositoryCatalogApi } from "@rebase/contracts";
import { useCallback } from "react";
import type { Navigate } from "#web/app/shell/use-navigation";
import type { ProjectNavigationRepository } from "#web/features/project-navigation/project-navigation";
import { catalogWith } from "#web/features/repository-catalog/use-repository-catalog";
import { useEnvironment } from "#web/platform/query/environment-context";
import { useCommand } from "#web/platform/query/use-command";

export function useRepositoryOpening(navigate: Navigate) {
  const { status } = useEnvironment();
  const { run: recordOpened } = useCommand(RepositoryCatalogApi.recordOpened, {
    answers: catalogWith,
  });
  const available = status.availability === "available";
  const showRepository = useCallback(
    (repository: ProjectNavigationRepository) =>
      navigate({ type: "open-repository", repository }),
    [navigate],
  );
  const openRepository = useCallback(
    (repository: ProjectNavigationRepository) => {
      if (!available) return;
      showRepository(repository);
      void recordOpened({ repositoryId: repository.id });
    },
    [available, recordOpened, showRepository],
  );
  return { openRepository, showRepository };
}
