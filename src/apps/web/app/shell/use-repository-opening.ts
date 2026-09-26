import { useCallback, useEffect, useMemo } from "react";
import {
  createOpenedRepositoryStore,
  openedRepositoryTarget,
} from "#web/app/shell/opened-repository";
import {
  type Navigate,
  type Navigation,
  worktreePathFor,
} from "#web/app/shell/use-navigation";
import type { ProjectNavigationRepository } from "#web/features/project-navigation/project-navigation.contract";
import { useRecordRepositoryOpened } from "#web/features/repository-catalog/hooks/use-catalog-commands";
import { useRepositoryCatalog } from "#web/features/repository-catalog/hooks/use-repository-catalog";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader.contract";
import { useEnvironment } from "#web/platform/query/environment-context";

export function useRepositoryOpening(
  gateway: RepositoryHistoryGateway,
  navigation: Navigation,
  navigate: Navigate,
) {
  const opened = useMemo(() => createOpenedRepositoryStore(gateway), [gateway]);
  useEffect(() => () => opened.open(undefined), [opened]);
  const { environmentId, status } = useEnvironment();
  const { findRepository } = useRepositoryCatalog();
  const { mutate: recordOpened } = useRecordRepositoryOpened();
  const available = status.availability === "available";
  const openRepository = useCallback(
    (repository: ProjectNavigationRepository) => {
      if (!available) return;
      const entry = findRepository(repository.id);
      if (entry !== undefined && environmentId !== undefined)
        opened.open(
          openedRepositoryTarget(
            environmentId,
            entry,
            worktreePathFor(navigation, entry),
          ),
        );
      recordOpened({ repositoryId: repository.id });
      navigate({ type: "open-repository", repository });
    },
    [
      available,
      environmentId,
      findRepository,
      navigate,
      navigation,
      opened,
      recordOpened,
    ],
  );
  return { opened, openRepository };
}
