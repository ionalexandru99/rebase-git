import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  GitSigningApi,
  type RepositorySigning,
  type Signing,
} from "#contracts/git-signing/git-signing.contract.ts";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import { signingKey } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import {
  RepositorySigningRow,
  ServerSigningRow,
} from "#web/features/git-signing/git-signing.tsx";

const repositoryId = "00000000-0000-4000-8000-000000000042";
const gpgKey = signingKey({
  format: "openpgp",
  key: "EE7C6B972342375965730C86AD5EB245D759C8BC",
  label: "D759C8BC · ada@example.com",
});

describe("Git signing", () => {
  it("turns signing on with a key the server can sign with", async () => {
    let signing: Signing = { _tag: "Off" };
    const saved: unknown[] = [];
    await render(<ServerSigningRow />, {
      environment: {
        requests: fakeRequests(
          respond(GitSigningApi.read, async () => signing),
          respond(GitSigningApi.keys, async () => [signingKey(), gpgKey]),
          respond(GitSigningApi.save, async (input) => {
            saved.push(input);
            signing = { _tag: "Key", ...gpgKey };
            return signing;
          }),
        ),
      },
    });
    const select = page.getByRole("combobox", { name: "Sign commits" });
    await expect.element(select).toHaveTextContent("Off");

    await select.click();
    await page
      .getByRole("option", { name: "GPG · D759C8BC · ada@example.com" })
      .click();

    await expect
      .element(select)
      .toHaveTextContent("GPG · D759C8BC · ada@example.com");
    expect(saved).toEqual([
      { _tag: "Key", format: "openpgp", key: gpgKey.key },
    ]);
  });

  it("names the inherited key in the default option and matches a short key id to its listed key", async () => {
    let signing: RepositorySigning = {
      local: null,
      inherited: { _tag: "Key", ...signingKey() },
    };
    const saved: unknown[] = [];
    await render(<RepositorySigningRow repositoryId={repositoryId} />, {
      environment: {
        requests: fakeRequests(
          respond(GitSigningApi.readRepository, async () => signing),
          respond(GitSigningApi.keys, async () => [signingKey(), gpgKey]),
          respond(GitSigningApi.saveRepository, async (input) => {
            saved.push(input);
            signing = {
              ...signing,
              local: {
                _tag: "Key",
                format: "openpgp",
                key: "D759C8BC",
                label: "D759C8BC",
              },
            };
            return signing;
          }),
        ),
      },
    });
    const select = page.getByRole("combobox", { name: "Sign commits" });
    await expect
      .element(select)
      .toHaveTextContent("Default (SSH · id_ed25519)");

    await select.click();
    await page
      .getByRole("option", { name: "GPG · D759C8BC · ada@example.com" })
      .click();

    await expect
      .element(select)
      .toHaveTextContent("GPG · D759C8BC · ada@example.com");
    expect(saved).toEqual([
      {
        repositoryId,
        signing: { _tag: "Key", format: "openpgp", key: gpgKey.key },
      },
    ]);
  });

  it("goes back to the saved choice and says why when the server cannot save it", async () => {
    await render(<ServerSigningRow />, {
      environment: {
        requests: fakeRequests(
          respond(GitSigningApi.read, async () => ({ _tag: "Off" as const })),
          respond(GitSigningApi.keys, async () => [signingKey()]),
          respond(GitSigningApi.save, async () => {
            throw rejected({
              _tag: "SigningFailed" as const,
              detail: "error: could not lock config file /home/ada/.gitconfig",
            });
          }),
        ),
      },
    });
    const select = page.getByRole("combobox", { name: "Sign commits" });

    await select.click();
    await page.getByRole("option", { name: "SSH · id_ed25519" }).click();

    await expect
      .element(
        page.getByText("Could not lock config file /home/ada/.gitconfig."),
      )
      .toBeVisible();
    await expect.element(select).toHaveTextContent("Off");
  });
});
