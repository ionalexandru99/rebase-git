import { describe, expect, it } from "vite-plus/test";
import { hostRepositories } from "#tests-support/fixtures.ts";
import type { OpenProjectEnvironment } from "#web/features/open-project/open-project-model.ts";
import {
  cloneGroups,
  formatLastOpened,
  projectItems,
} from "#web/features/open-project/open-project-state.ts";

const TestEnvironmentIcon = (() =>
  null) as unknown as OpenProjectEnvironment["icon"];

describe("open project state", () => {
  it("matches repository names and paths", () => {
    const environments = environmentFixtures();

    expect(projectNames(projectItems(environments, "WORK"))).toEqual([
      "workbench",
    ]);
    expect(projectNames(projectItems(environments, "/srv"))).toEqual([
      "ci-images",
      "infrastructure",
    ]);
  });

  it("lists every project once, most recently opened first", () => {
    const projects = projectItems(environmentFixtures(), "");

    expect(projectNames(projects)).toEqual([
      "rebase-git",
      "workbench",
      "api-experiments",
      "ci-images",
      "infrastructure",
      "never-opened",
    ]);
  });

  it("keeps projects of an unavailable Environment but disables them", () => {
    const environments = environmentFixtures().map((environment) =>
      environment.id === "build"
        ? { ...environment, availability: "unavailable" as const }
        : environment,
    );

    expect(
      projectNames(
        projectItems(environments, "").filter((item) => item.disabled),
      ),
    ).toEqual(["ci-images", "infrastructure"]);
  });

  it("drops the signed-in owner and tags only the minority visibility", () => {
    const [group] = cloneGroups(
      [
        hostRepositories({
          account: "Alex",
          repositories: [
            { name: "alex/rebase-git" },
            { name: "alex/notes", private: true },
            { name: "alex/dotfiles", private: true },
            { name: "acme/api", private: true },
          ],
        }),
      ],
      "",
    );

    expect(
      group?.sources.map(({ label, visibility }) => [label, visibility]),
    ).toEqual([
      ["rebase-git", "Public"],
      ["notes", undefined],
      ["dotfiles", undefined],
      ["acme/api", undefined],
    ]);
  });

  it("tags no visibility when every repository shares it", () => {
    const [group] = cloneGroups(
      [
        hostRepositories({
          repositories: [
            { name: "acme/api", private: true },
            { name: "acme/web", private: true },
          ],
        }),
      ],
      "",
    );

    expect(group?.sources.map(({ visibility }) => visibility)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("formats compact recent times", () => {
    const now = new Date("2026-08-24T15:00:00").getTime();

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
          color: "blue",
          environmentId: "local",
          id: "workbench",
          lastOpenedAt: "2026-08-22T10:00:00Z",
          name: "workbench",
          path: "~/Personal/workbench",
        },
        {
          color: "blue",
          environmentId: "local",
          id: "rebase",
          lastOpenedAt: "2026-08-24T12:00:00Z",
          name: "rebase-git",
          path: "~/Code/rebase-git",
        },
        {
          color: "blue",
          environmentId: "local",
          id: "never",
          name: "never-opened",
          path: "~/Code/never-opened",
        },
        {
          color: "blue",
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
          color: "blue",
          environmentId: "build",
          id: "infrastructure",
          lastOpenedAt: "2026-08-19T10:00:00Z",
          name: "infrastructure",
          path: "/srv/git/infrastructure",
        },
        {
          color: "blue",
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

function projectNames(
  items: ReturnType<typeof projectItems>,
): readonly string[] {
  return items.map((item) => item.repository.name);
}
