import { describe, expect, it } from "vite-plus/test";
import type { ProjectNavigationState } from "#web/features/project-navigation/project-navigation.contract";
import {
  environmentRepositories,
  filterEnvironmentRepositories,
  setEnvironmentAvailability,
  setProjectSidebarCollapsed,
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
      environments: [{ expanded: true }],
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
  };
}

function unreachable(): never {
  throw new Error("Expected an Environment in the navigation state.");
}
