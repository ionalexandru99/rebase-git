import { describe, expect, it } from "vite-plus/test";
import {
  initialNavigation,
  reduceNavigation,
} from "#web/app/shell/use-navigation";

const repository = { id: "payments", name: "payments" };

describe("shell navigation", () => {
  it("opens a repository in place of its settings", () => {
    const settings = reduceNavigation(initialNavigation(), {
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
    const opened = reduceNavigation(initialNavigation(), {
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
});
