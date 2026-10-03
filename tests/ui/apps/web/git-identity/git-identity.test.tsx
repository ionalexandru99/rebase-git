import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  type GitIdentity,
  GitIdentityApi,
  type RepositoryIdentity,
} from "#contracts/git-identity/git-identity.contract.ts";
import {
  type FakeRoute,
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import { render } from "#tests-support/render.tsx";
import { SettingsSection } from "#web/components/ui/settings-layout.tsx";
import {
  RepositoryIdentityRow,
  ServerIdentityRow,
} from "#web/features/git-identity/git-identity.tsx";

const repositoryId = "00000000-0000-4000-8000-000000000042";

describe("Git identity", () => {
  it("opens the Git row when no name and email are set and saves them on the server", async () => {
    let identity: GitIdentity = {};
    await renderServerIdentity(
      respond(GitIdentityApi.read, async () => identity),
      respond(GitIdentityApi.save, async (input) => {
        identity = input;
        return identity;
      }),
    );
    await expect.element(page.getByText("Identity missing")).toBeVisible();

    await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
    await page.getByRole("textbox", { name: "Email" }).fill("ada@example.com");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .element(page.getByRole("button", { name: "Show identity" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Name" }))
      .not.toBeInTheDocument();
    expect(identity).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("keeps the form open and says why the server could not save it", async () => {
    await renderServerIdentity(
      respond(GitIdentityApi.read, async () => ({})),
      respond(GitIdentityApi.save, async () => {
        throw rejected({
          _tag: "IdentityFailed" as const,
          detail: "error: could not lock config file /home/ada/.gitconfig",
        });
      }),
    );

    await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .element(
        page.getByText("Could not lock config file /home/ada/.gitconfig."),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Name" }))
      .toHaveValue("Ada Lovelace");
  });

  it("shows the inherited identity in a repository and removes its override", async () => {
    let identity: RepositoryIdentity = {
      local: { email: "ada@repo.example" },
      inherited: { name: "Ada Lovelace", email: "ada@example.com" },
    };
    const saved: unknown[] = [];
    await render(
      <SettingsSection title="Git">
        <RepositoryIdentityRow repositoryId={repositoryId} />
      </SettingsSection>,
      {
        environment: {
          requests: fakeRequests(
            respond(GitIdentityApi.readRepository, async () => identity),
            respond(GitIdentityApi.saveRepository, async (input) => {
              saved.push(input);
              identity = { ...identity, local: input.identity };
              return identity;
            }),
          ),
        },
      },
    );
    await expect
      .element(page.getByText("· set for this repository"))
      .toBeVisible();

    await page.getByRole("button", { name: "Repository identity" }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Name" }))
      .toHaveAttribute("placeholder", "Ada Lovelace");
    await page.getByRole("button", { name: "Remove override" }).click();

    await expect
      .element(page.getByText("· set for this repository"))
      .not.toBeInTheDocument();
    expect(saved).toEqual([{ repositoryId, identity: {} }]);
  });
});

function renderServerIdentity(...routes: readonly FakeRoute[]) {
  return render(
    <SettingsSection title="Version Control">
      <ServerIdentityRow icon={null} version="git version 2.55.0" />
    </SettingsSection>,
    { environment: { requests: fakeRequests(...routes) } },
  );
}
