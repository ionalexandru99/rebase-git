import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  type CloneRepository,
  RepositoryCatalogApi,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import { catalogEntry } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { OpenProjectScreen } from "#web/features/open-project/open-project-screen.tsx";

describe("cloning from the open project screen", () => {
  it("clones a GitHub repository found by search, shows its progress and opens it", async () => {
    const requested: CloneRepository[] = [];
    let finish: () => void = () => {};
    const opened = vi.fn();
    await renderScreen(
      respond(RepositoryCatalogApi.clone, (input, { progress }) => {
        requested.push(input);
        progress?.(46);
        return new Promise((resolve) => {
          finish = () =>
            resolve(
              catalogEntry({
                id: input.repositoryId,
                name: "checkout-service",
                path: input.path,
              }),
            );
        });
      }),
      opened,
    );

    await userEvent.type(search(), "check");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect
      .element(page.getByRole("textbox", { name: "Clone into" }))
      .toHaveValue("/home/alex/code/checkout-service");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(
        page.getByRole("progressbar", { name: "Cloning checkout-service" }),
      )
      .toHaveAttribute("aria-valuenow", "46");
    finish();

    await expect
      .poll(() => opened.mock.calls[0]?.[0])
      .toMatchObject({ name: "checkout-service" });
    expect(requested).toEqual([
      {
        repositoryId: expect.any(String),
        url: "git@github.com:acme/checkout-service.git",
        path: "/home/alex/code/checkout-service",
      },
    ]);
  });

  it("clones a pasted URL without showing its credentials and explains a refused folder", async () => {
    const requested: CloneRepository[] = [];
    await renderScreen(
      respond(RepositoryCatalogApi.clone, (input) => {
        requested.push(input);
        throw rejected({
          _tag: "RepositoryNotCreated",
          reason: "DestinationNotEmpty",
        });
      }),
    );

    await userEvent.type(
      search(),
      "https://alex:secret@git.example.com/acme/legacy.git",
    );
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect
      .element(page.getByRole("textbox", { name: "Clone into" }))
      .toHaveValue("/home/alex/code/legacy");
    await userEvent.keyboard("{Enter}");

    await expect
      .element(page.getByText("This folder already exists and isn't empty."))
      .toBeVisible();
    await expect
      .element(
        page.getByRole("option", { name: /git\.example\.com\/acme\/legacy/ }),
      )
      .toBeVisible();
    expect(page.getByText(/secret/).elements()).toHaveLength(0);
    expect(requested[0]?.path).toBe("/home/alex/code/legacy");
  });
});

function search() {
  return page.getByRole("searchbox", { name: "Search repositories" });
}

async function renderScreen(
  clone: ReturnType<typeof respond<typeof RepositoryCatalogApi.clone>>,
  onRepositoryRemembered: (repository: unknown) => void = () => {},
) {
  return render(
    <OpenProjectScreen
      onOpenRepository={() => {}}
      onOpenSettings={() => {}}
      onRepositoryRemembered={onRepositoryRemembered}
    />,
    {
      environment: {
        requests: fakeRequests(
          respond(RepositoryCatalogApi.list, () => ({ repositories: [] })),
          respond(RepositoryCatalogApi.defaults, () => ({
            cloneFolder: "/home/alex/code",
            initialBranch: "main",
          })),
          respond(SourceControlApi.cloneable, () => [
            {
              kind: "github" as const,
              account: "alex",
              repositories: [
                {
                  name: "acme/checkout-service",
                  url: "git@github.com:acme/checkout-service.git",
                  private: true,
                },
                {
                  name: "alex/dotfiles",
                  url: "git@github.com:alex/dotfiles.git",
                  private: false,
                },
              ],
            },
          ]),
          clone,
        ),
      },
    },
  );
}
