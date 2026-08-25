import { describe, expect, it } from "vite-plus/test";
import type { OpenProjectEnvironment } from "#web/features/open-project/open-project.contract";
import {
  catalogRepositoryItems,
  filterOpenProjectEnvironments,
  formatLastOpened,
  keyboardRepositoryItems,
  recentRepositoryItems,
  repositoryInitials,
} from "#web/features/open-project/open-project-state";

const TestEnvironmentIcon = (() =>
  null) as unknown as OpenProjectEnvironment["icon"];

describe("open project state", () => {
  it("matches repository names, paths, and Environment names", () => {
    const environments = environmentFixtures();

    expect(
      repositoryNames(filterOpenProjectEnvironments(environments, "WORK")),
    ).toEqual(["workbench"]);
    expect(
      repositoryNames(filterOpenProjectEnvironments(environments, "/srv")),
    ).toEqual(["ci-images", "infrastructure"]);
    expect(
      repositoryNames(filterOpenProjectEnvironments(environments, "BUILD")),
    ).toEqual(["ci-images", "infrastructure"]);
  });

  it("keeps Environment order and sorts repositories alphabetically without mutation", () => {
    const environments = environmentFixtures();

    const filtered = filterOpenProjectEnvironments(environments, "");

    expect(filtered.map((environment) => environment.id)).toEqual([
      "local",
      "build",
    ]);
    expect(repositoryNames(filtered)).toEqual([
      "api-experiments",
      "rebase-git",
      "workbench",
      "ci-images",
      "infrastructure",
    ]);
    expect(
      environments[0]?.repositories.map((repository) => repository.name),
    ).toEqual(["workbench", "rebase-git", "api-experiments"]);
  });

  it("returns the four most recent repositories", () => {
    const recent = recentRepositoryItems(environmentFixtures());

    expect(recent.map((item) => item.repository.name)).toEqual([
      "rebase-git",
      "workbench",
      "api-experiments",
      "ci-images",
    ]);
  });

  it("keeps unavailable repositories visible but out of keyboard navigation", () => {
    const environments = environmentFixtures().map((environment) =>
      environment.id === "build"
        ? { ...environment, availability: "unavailable" as const }
        : environment,
    );
    const catalog = catalogRepositoryItems(
      environments,
      new Set(["local", "build"]),
    );

    expect(catalog).toHaveLength(5);
    expect(
      catalog
        .filter((item) => item.disabled)
        .map((item) => item.repository.name),
    ).toEqual(["ci-images", "infrastructure"]);
    expect(
      keyboardRepositoryItems([], catalog).map((item) => item.repository.name),
    ).toEqual(["api-experiments", "rebase-git", "workbench"]);
  });

  it("orders keyboard items from recents into expanded Environment groups", () => {
    const environments = filterOpenProjectEnvironments(
      environmentFixtures(),
      "",
    );
    const recent = recentRepositoryItems(environments);
    const catalog = catalogRepositoryItems(environments, new Set(["local"]));

    expect(
      keyboardRepositoryItems(recent, catalog).map((item) => item.key),
    ).toEqual([
      "recent:local:rebase",
      "recent:local:workbench",
      "recent:local:api",
      "recent:build:ci",
      "catalog:local:api",
      "catalog:local:rebase",
      "catalog:local:workbench",
    ]);
  });

  it("formats repository initials and compact recent times", () => {
    const now = new Date("2026-08-24T15:00:00");

    expect(repositoryInitials("rebase-git")).toBe("RG");
    expect(formatLastOpened("2026-08-24T13:00:00", now)).toBe("2h");
    expect(formatLastOpened("2026-08-23T20:00:00", now)).toBe("Yesterday");
  });
});

function environmentFixtures(): readonly OpenProjectEnvironment[] {
  return [
    {
      availability: "available",
      icon: TestEnvironmentIcon,
      iconColor: "#7c8cff",
      id: "local",
      name: "Local Environment",
      repositories: [
        {
          environmentId: "local",
          id: "workbench",
          lastOpenedAt: "2026-08-22T10:00:00Z",
          name: "workbench",
          path: "~/Personal/workbench",
        },
        {
          environmentId: "local",
          id: "rebase",
          lastOpenedAt: "2026-08-24T12:00:00Z",
          name: "rebase-git",
          path: "~/Code/rebase-git",
        },
        {
          environmentId: "local",
          id: "api",
          lastOpenedAt: "2026-08-21T10:00:00Z",
          name: "api-experiments",
          path: "~/Code/api-experiments",
        },
      ],
      status: "Connected",
    },
    {
      availability: "available",
      icon: TestEnvironmentIcon,
      iconColor: "#d39a59",
      id: "build",
      name: "Build server",
      repositories: [
        {
          environmentId: "build",
          id: "infrastructure",
          lastOpenedAt: "2026-08-19T10:00:00Z",
          name: "infrastructure",
          path: "/srv/git/infrastructure",
        },
        {
          environmentId: "build",
          id: "ci",
          lastOpenedAt: "2026-08-20T10:00:00Z",
          name: "ci-images",
          path: "/srv/git/ci-images",
        },
      ],
      status: "Connected",
    },
  ];
}

function repositoryNames(
  environments: readonly OpenProjectEnvironment[],
): readonly string[] {
  return environments.flatMap((environment) =>
    environment.repositories.map((repository) => repository.name),
  );
}
