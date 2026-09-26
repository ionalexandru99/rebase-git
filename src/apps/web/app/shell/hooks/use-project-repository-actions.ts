import type {
  RepositoryCatalogEntry,
  RepositoryFilesystemHost,
} from "@rebase/contracts";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import type { OpenProjectRepository } from "#web/features/open-project/index";
import {
  type EnvironmentAvailability,
  openProjectRepository,
  type ProjectNavigationRepository,
  type ProjectNavigationState,
  removeProjectRepository,
  setEnvironmentAvailability,
} from "#web/features/project-navigation/index";
import {
  useRecordRepositoryOpened,
  useRemoveRepository,
} from "#web/features/repository-catalog/index";

export function useProjectRepositoryActions({
  availability,
  environmentId,
  repositoryFilesystem,
  setNavigation,
  onRepositoryOpened,
}: {
  readonly availability: EnvironmentAvailability;
  readonly environmentId: string;
  readonly repositoryFilesystem: RepositoryFilesystemHost | undefined;
  readonly onRepositoryOpened: (repositoryId: string) => void;
  readonly setNavigation: Dispatch<SetStateAction<ProjectNavigationState>>;
}) {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [expandedEnvironmentIds, setExpandedEnvironmentIds] = useState<
    ReadonlySet<string>
  >(() => new Set([environmentId]));
  const { mutate: recordOpened } = useRecordRepositoryOpened();
  const { mutateAsync: removeFromCatalog } = useRemoveRepository();

  const openRepository = useCallback(
    (
      selectedEnvironmentId: string,
      repository: ProjectNavigationRepository,
    ) => {
      if (availability !== "available") return;

      onRepositoryOpened(repository.id);
      recordOpened({ repositoryId: repository.id });
      setNavigation((current) =>
        openProjectRepository(
          withAvailability(current, environmentId, availability),
          selectedEnvironmentId,
          repository,
        ),
      );
    },
    [
      availability,
      environmentId,
      recordOpened,
      setNavigation,
      onRepositoryOpened,
    ],
  );

  const selectOpenProjectRepository = useCallback(
    (repository: OpenProjectRepository) =>
      openRepository(repository.environmentId, repository),
    [openRepository],
  );

  const browseRepository = useCallback(() => {
    if (availability === "available") setFolderPickerOpen(true);
  }, [availability]);

  const openRememberedRepository = useCallback(
    (selectedEnvironmentId: string, remembered: RepositoryCatalogEntry) => {
      onRepositoryOpened(remembered.id);
      setNavigation((current) =>
        openProjectRepository(
          withAvailability(current, environmentId, availability),
          selectedEnvironmentId,
          { id: remembered.id, name: remembered.name },
        ),
      );
    },
    [availability, environmentId, setNavigation, onRepositoryOpened],
  );

  const copyRepositoryPath = useCallback(
    (repository: OpenProjectRepository) => {
      return navigator.clipboard.writeText(repository.path);
    },
    [],
  );

  const revealRepository = useMemo(
    () =>
      repositoryFilesystem === undefined
        ? undefined
        : (repository: OpenProjectRepository) =>
            repositoryFilesystem.revealRepository(repository.path),
    [repositoryFilesystem],
  );

  const closeSidebarRepository = useCallback(
    (
      selectedEnvironmentId: string,
      repository: ProjectNavigationRepository,
    ) => {
      setNavigation((current) =>
        removeProjectRepository(current, selectedEnvironmentId, repository.id),
      );
    },
    [setNavigation],
  );

  const removeRepository = useCallback(
    (repository: OpenProjectRepository) => {
      return removeFromCatalog({ repositoryId: repository.id }).then(() =>
        setNavigation((current) =>
          removeProjectRepository(
            current,
            repository.environmentId,
            repository.id,
          ),
        ),
      );
    },
    [removeFromCatalog, setNavigation],
  );

  const setEnvironmentExpanded = useCallback(
    (selectedEnvironmentId: string, open: boolean) => {
      setExpandedEnvironmentIds((current) => {
        const next = new Set(current);
        if (open) next.add(selectedEnvironmentId);
        else next.delete(selectedEnvironmentId);
        return next;
      });
    },
    [],
  );

  return {
    browseRepository,
    closeSidebarRepository,
    copyRepositoryPath,
    expandedEnvironmentIds,
    folderPickerOpen,
    openRememberedRepository,
    removeRepository,
    revealRepository,
    selectOpenProjectRepository,
    selectSidebarRepository: openRepository,
    setEnvironmentExpanded,
    setFolderPickerOpen,
  };
}

function withAvailability(
  navigation: ProjectNavigationState,
  environmentId: string,
  availability: EnvironmentAvailability,
) {
  return setEnvironmentAvailability(navigation, environmentId, availability);
}
