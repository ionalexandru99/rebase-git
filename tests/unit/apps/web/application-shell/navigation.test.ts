import { describe, expect, it } from "vite-plus/test";
import {
  type Navigation,
  reduceNavigation,
} from "#web/app/shell/use-navigation";
import { localEnvironment } from "#web/features/project-navigation/local-environment";

const repository = { id: "payments", name: "payments" };

describe("shell navigation", () => {
  it("opens a repository in place of its settings", () => {
    const settings = reduceNavigation(navigation(), {
      type: "show-repository-settings",
      repositoryId: repository.id,
    });

    const opened = reduceNavigation(settings, {
      type: "open-repository",
      repository,
    });

    expect(opened.repositorySettingsId).toBeUndefined();
    expect(opened.projects).toMatchObject({
      selectedRepositoryId: repository.id,
      workspaceView: "repository",
    });
    expect(opened.projects.environments[0]?.repositories).toEqual([repository]);
  });

  it("closes the settings of a repository that leaves the sidebar", () => {
    const opened = reduceNavigation(navigation(), {
      type: "open-repository",
      repository,
    });
    const settings = reduceNavigation(opened, {
      type: "show-repository-settings",
      repositoryId: repository.id,
    });

    const closed = reduceNavigation(settings, {
      type: "close-repository",
      repositoryId: repository.id,
    });

    expect(closed.repositorySettingsId).toBeUndefined();
    expect(closed.projects).toMatchObject({
      selectedRepositoryId: undefined,
      workspaceView: "open-project",
    });
  });

  it("remembers the chosen worktree for each repository", () => {
    const switched = reduceNavigation(navigation(), {
      type: "switch-worktree",
      repositoryId: repository.id,
      worktreePath: "/payments/.worktrees/topic",
    });

    expect(switched.worktreePaths.get(repository.id)).toBe(
      "/payments/.worktrees/topic",
    );
  });
});

function navigation(): Navigation {
  return {
    projects: {
      environments: [
        {
          availability: "connecting",
          expanded: true,
          id: localEnvironment.id,
          name: localEnvironment.name,
          repositories: [],
        },
      ],
      selectedRepositoryId: undefined,
      sidebarCollapsed: false,
      workspaceView: "open-project",
    },
    settingsOpen: false,
    repositorySettingsId: undefined,
    openProjectRequest: 0,
    worktreePaths: new Map(),
  };
}
