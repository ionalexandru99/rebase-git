import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";
import type { LocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session.contract";
import type { OpenProjectRepository } from "#web/features/open-project/open-project.contract";
import type {
  EnvironmentAvailability,
  ProjectNavigationRepository,
  ProjectNavigationState,
} from "#web/features/project-navigation/project-navigation.contract";
import {
  openProjectRepository,
  removeProjectRepository,
  setEnvironmentAvailability,
} from "#web/features/project-navigation/project-navigation-state";

export function useProjectRepositoryActions({
  availability,
  environmentId,
  session,
  setNavigation,
}: {
  readonly availability: EnvironmentAvailability;
  readonly environmentId: string;
  readonly session: LocalEnvironmentSession;
  readonly setNavigation: Dispatch<SetStateAction<ProjectNavigationState>>;
}) {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [expandedEnvironmentIds, setExpandedEnvironmentIds] = useState<
    ReadonlySet<string>
  >(() => new Set([environmentId]));

  const openRepository = useCallback(
    (
      selectedEnvironmentId: string,
      repository: ProjectNavigationRepository,
    ) => {
      if (availability !== "available") return;

      void session.repositoryCatalog
        .recordOpened(repository.id)
        .catch(() => undefined);
      setNavigation((current) =>
        openProjectRepository(
          withAvailability(current, environmentId, availability),
          selectedEnvironmentId,
          repository,
        ),
      );
    },
    [availability, environmentId, session.repositoryCatalog, setNavigation],
  );

  const selectOpenProjectRepository = useCallback(
    (repository: OpenProjectRepository) =>
      openRepository(repository.environmentId, repository),
    [openRepository],
  );

  const browseRepository = useCallback(() => {
    if (availability === "available") setFolderPickerOpen(true);
  }, [availability]);

  const listRepositoryDirectory = useCallback(
    (selectedEnvironmentId: string, path?: string) => {
      if (selectedEnvironmentId !== environmentId) {
        return Promise.reject(new Error("The Environment is unavailable."));
      }
      return session.filesystem.listDirectory(path);
    },
    [environmentId, session.filesystem],
  );

  const openRepositoryFromFolder = useCallback(
    async (selectedEnvironmentId: string, path: string) => {
      if (
        selectedEnvironmentId !== environmentId ||
        availability !== "available"
      ) {
        throw new Error("The Environment is unavailable.");
      }
      const remembered = await session.repositoryCatalog.remember(path);
      setNavigation((current) =>
        openProjectRepository(
          withAvailability(current, environmentId, availability),
          selectedEnvironmentId,
          {
            id: remembered.id,
            name: remembered.name,
          },
        ),
      );
    },
    [availability, environmentId, session.repositoryCatalog, setNavigation],
  );

  const copyRepositoryPath = useCallback(
    (repository: OpenProjectRepository) => {
      void navigator.clipboard
        .writeText(repository.path)
        .catch(() => undefined);
    },
    [],
  );

  const revealRepository = useCallback((repository: OpenProjectRepository) => {
    void window.rebaseHost
      ?.revealRepository(repository.path)
      .catch(() => undefined);
  }, []);

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

  const closeSelectedRepository = useCallback(() => {
    setNavigation((current) => {
      if (current.selectedRepositoryId === undefined) return current;
      const environment = current.environments.find((candidate) =>
        candidate.repositories.some(
          (repository) => repository.id === current.selectedRepositoryId,
        ),
      );
      return environment === undefined
        ? current
        : removeProjectRepository(
            current,
            environment.id,
            current.selectedRepositoryId,
          );
    });
  }, [setNavigation]);

  const removeRepository = useCallback(
    (repository: OpenProjectRepository) => {
      void session.repositoryCatalog
        .remove(repository.id)
        .then(() =>
          setNavigation((current) =>
            removeProjectRepository(
              current,
              repository.environmentId,
              repository.id,
            ),
          ),
        )
        .catch(() => undefined);
    },
    [session.repositoryCatalog, setNavigation],
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
    closeSelectedRepository,
    closeSidebarRepository,
    copyRepositoryPath,
    expandedEnvironmentIds,
    folderPickerOpen,
    listRepositoryDirectory,
    openRepositoryFromFolder,
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
