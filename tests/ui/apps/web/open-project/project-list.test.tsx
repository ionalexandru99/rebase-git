import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { catalogEntry } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { OpenProjectScreen } from "#web/features/open-project/open-project-screen.tsx";

describe("projects on the open project screen", () => {
  it("lists each project once and shows ten until asked for all", async () => {
    await render(
      <OpenProjectScreen
        onOpenRepository={() => {}}
        onOpenSettings={() => {}}
        onRepositoryRemembered={() => {}}
      />,
      {
        environment: {
          requests: fakeRequests(
            respond(RepositoryCatalogApi.list, () => ({
              repositories: Array.from({ length: 12 }, (_, index) =>
                catalogEntry({
                  id: `project-${index}`,
                  name: `project-${index}`,
                  path: `/home/alex/code/project-${index}`,
                  lastOpenedAt: new Date(
                    Date.UTC(2026, 8, 30 - index),
                  ).toISOString(),
                }),
              ),
            })),
            respond(SourceControlApi.cloneable, () => []),
          ),
        },
      },
    );
    const projects = page
      .getByRole("region", { name: "Projects" })
      .getByRole("option");

    await expect.element(projects.first()).toHaveTextContent("project-0");
    expect(projects.elements()).toHaveLength(10);

    await page.getByRole("button", { name: "Show all 12 projects" }).click();

    await expect.element(projects.nth(11)).toHaveTextContent("project-11");
    expect(
      page.getByRole("button", { name: /^Show all/ }).elements(),
    ).toHaveLength(0);
  });
});
