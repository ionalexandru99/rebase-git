import { IconDeviceLaptop } from "@tabler/icons-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { EnvironmentFilesystemApi } from "#contracts/environment-filesystem/environment-filesystem.contract.ts";
import {
  type InitializeRepository,
  RepositoryCatalogApi,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { catalogEntry } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { RepositoryFolderPicker } from "#web/features/repository-folder-picker/repository-folder-browser.tsx";

describe("initializing a repository from the folder picker", () => {
  it("initializes a selected folder that holds no repository on the default branch", async () => {
    const { initialized, opened } = await renderPicker();
    const picker = page.getByRole("dialog", { name: "Choose repository" });

    await picker
      .getByRole("button", { name: /^storefront Repository/ })
      .click();
    await expect
      .element(picker.getByRole("button", { name: "Open repository" }))
      .toBeEnabled();
    await picker.getByRole("button", { name: /^notes-app Folder/ }).click();
    await expect
      .element(picker.getByRole("textbox", { name: "Initial branch" }))
      .toHaveValue("trunk");
    await picker.getByRole("button", { name: "Initialize repository" }).click();

    await expect.poll(() => opened.mock.calls.length).toBe(1);
    expect(initialized).toEqual([
      { path: "/home/alex/code/notes-app", branch: "trunk" },
    ]);
  });

  it("creates and initializes a new folder named in place", async () => {
    const { initialized } = await renderPicker();
    const picker = page.getByRole("dialog", { name: "Choose repository" });

    await picker.getByRole("button", { name: "New folder" }).click();
    await userEvent.keyboard("billing-worker{Enter}");

    await expect
      .poll(() => initialized)
      .toEqual([{ path: "/home/alex/code/billing-worker", branch: "trunk" }]);
  });
});

async function renderPicker() {
  const initialized: InitializeRepository[] = [];
  const opened = vi.fn();
  await render(
    <RepositoryFolderPicker
      environments={[
        {
          availability: "available",
          icon: IconDeviceLaptop,
          iconColor: "var(--primary)",
          id: "local",
          name: "Local Environment",
          status: "Available",
        },
      ]}
      onOpenChange={() => {}}
      onRepositoryOpened={opened}
      open
    />,
    {
      environment: {
        requests: fakeRequests(
          respond(EnvironmentFilesystemApi.listDirectory, () => ({
            path: "/home/alex/code",
            breadcrumbs: [{ name: "code", path: "/home/alex/code" }],
            entries: [
              {
                kind: "Folder",
                name: "notes-app",
                path: "/home/alex/code/notes-app",
                type: "directory" as const,
              },
              {
                kind: "Repository",
                name: "storefront",
                path: "/home/alex/code/storefront",
                type: "directory" as const,
              },
            ],
            repository: false,
            truncated: false,
          })),
          respond(RepositoryCatalogApi.defaults, () => ({
            cloneFolder: "/home/alex/code",
            initialBranch: "trunk",
          })),
          respond(RepositoryCatalogApi.initialize, (input) => {
            initialized.push(input);
            return catalogEntry({ name: "notes-app", path: input.path });
          }),
        ),
      },
    },
  );
  return { initialized, opened };
}
