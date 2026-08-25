import { describe, expect, it } from "vite-plus/test";
import type { ProjectNavigationState } from "#web/features/project-navigation/project-navigation.contract";
import {
  environmentRepositories,
  filterEnvironmentRepositories,
  openProjectRepository,
  removeProjectRepository,
  setEnvironmentAvailability,
  setProjectSidebarCollapsed,
  showOpenProject,
  toggleEnvironment,
} from "#web/features/project-navigation/project-navigation-state";

describe("project navigation state", () => {
  it("keeps known repositories visible and disables them when their Environment is unavailable", () => {
    const state = navigationState();

    const unavailable = setEnvironmentAvailability(
      state,
      "office",
      "unavailable",
    );

    expect(unavailable.environments[0]?.repositories).toHaveLength(2);
    expect(
      environmentRepositories(unavailable.environments[0] ?? unreachable()),
    ).toEqual([
      { disabled: true, id: "payments", name: "payments" },
      { disabled: true, id: "worker", name: "worker" },
    ]);
  });

  it("collapses one Environment without losing its repositories", () => {
    const state = navigationState();

    const collapsed = toggleEnvironment(state, "office");

    expect(collapsed.environments[0]).toMatchObject({
      expanded: false,
      repositories: [{ id: "payments" }, { id: "worker" }],
    });
  });

  it("filters repositories by name without changing the navigation state", () => {
    const state = navigationState();
    const environment = state.environments[0] ?? unreachable();

    expect(filterEnvironmentRepositories(environment, "WORK")).toEqual([
      { disabled: false, id: "worker", name: "worker" },
    ]);
    expect(filterEnvironmentRepositories(environment, "  ")).toHaveLength(2);
    expect(environment.repositories).toHaveLength(2);
  });

  it("collapses the Projects sidebar without changing Environment expansion or selection", () => {
    const state = navigationState();

    const collapsed = setProjectSidebarCollapsed(state, true);

    expect(collapsed).toMatchObject({
      selectedRepositoryId: "payments",
      sidebarCollapsed: true,
      workspaceView: "repository",
      environments: [{ expanded: true }],
    });
  });

  it("shows Open project without clearing the selected repository", () => {
    const state = navigationState();

    const openProject = showOpenProject(state);

    expect(openProject).toMatchObject({
      selectedRepositoryId: "payments",
      workspaceView: "open-project",
    });
    expect(openProject.environments).toBe(state.environments);
  });

  it("selects an open repository without adding a duplicate sidebar item", () => {
    const state = showOpenProject(navigationState());

    const selected = openProjectRepository(state, "office", {
      id: "worker",
      name: "worker",
    });

    expect(selected).toMatchObject({
      selectedRepositoryId: "worker",
      workspaceView: "repository",
    });
    expect(selected.environments[0]?.repositories).toEqual([
      { id: "payments", name: "payments" },
      { id: "worker", name: "worker" },
    ]);
  });

  it("adds a newly opened repository to its Environment once", () => {
    const state = showOpenProject(navigationState());

    const selected = openProjectRepository(state, "office", {
      id: "api",
      name: "api",
    });
    const selectedAgain = openProjectRepository(selected, "office", {
      id: "api",
      name: "api",
    });

    expect(selectedAgain.environments[0]?.repositories).toEqual([
      { id: "payments", name: "payments" },
      { id: "worker", name: "worker" },
      { id: "api", name: "api" },
    ]);
  });

  it("does not open repositories from an unavailable Environment", () => {
    const state = showOpenProject(
      setEnvironmentAvailability(navigationState(), "office", "unavailable"),
    );

    const selected = openProjectRepository(state, "office", {
      id: "api",
      name: "api",
    });

    expect(selected).toBe(state);
  });

  it("removes an open repository and clears its selection", () => {
    const state = navigationState();

    const removed = removeProjectRepository(state, "office", "payments");

    expect(removed).toMatchObject({
      selectedRepositoryId: undefined,
      workspaceView: "open-project",
    });
    expect(removed.environments[0]?.repositories).toEqual([
      { id: "worker", name: "worker" },
    ]);
  });

  it("removes another open repository without clearing the selection", () => {
    const state = navigationState();

    const removed = removeProjectRepository(state, "office", "worker");

    expect(removed).toMatchObject({
      selectedRepositoryId: "payments",
      workspaceView: "repository",
    });
  });
});

function navigationState(): ProjectNavigationState {
  return {
    environments: [
      {
        availability: "available",
        expanded: true,
        id: "office",
        name: "Office PC",
        repositories: [
          { id: "payments", name: "payments" },
          { id: "worker", name: "worker" },
        ],
      },
    ],
    selectedRepositoryId: "payments",
    sidebarCollapsed: false,
    workspaceView: "repository",
  };
}

function unreachable(): never {
  throw new Error("Expected an Environment in the navigation state.");
}
