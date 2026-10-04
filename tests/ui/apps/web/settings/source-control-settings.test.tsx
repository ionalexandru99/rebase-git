import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  type BitbucketToken,
  SourceControlApi,
} from "#contracts/source-control/source-control.contract.ts";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import { sourceControlDiscovery } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { SourceControlSettings } from "#web/features/settings/source-control-settings.tsx";

describe("source control settings", () => {
  it("shows the signed in accounts and switches GitHub off on the server", async () => {
    let enabled = true;
    const saved: unknown[] = [];
    await render(<SourceControlSettings />, {
      environment: {
        requests: fakeRequests(
          respond(SourceControlApi.discover, async () =>
            sourceControlDiscovery({
              github: {
                _tag: "SignedIn",
                kind: "github",
                enabled,
                version: "gh version 2.101.0 (2026-09-15)",
                accounts: [{ host: "github.com", account: "octo" }],
              },
              gitlab: {
                _tag: "SignedIn",
                kind: "gitlab",
                enabled: true,
                version: "glab 1.120.0 (78790114c)",
                accounts: [
                  { host: "gitlab.com", account: "tanuki" },
                  { host: "git.example.com", account: "tanuki" },
                ],
              },
            }),
          ),
          respond(SourceControlApi.setHostEnabled, async (input) => {
            saved.push(input);
            enabled = input.enabled;
          }),
        ),
      },
    });

    await expect.element(page.getByText("git version 2.51.0")).toBeVisible();
    expect(page.getByText("octo", { exact: true }).elements()).toHaveLength(0);
    await page
      .getByRole("button", { name: "Show account on github.com" })
      .click();
    await expect
      .element(
        page.getByRole("button", { name: "Hide account octo on github.com" }),
      )
      .toHaveTextContent("octo");
    await expect
      .element(page.getByText(/on gitlab\.com, .* on git\.example\.com$/))
      .toBeVisible();
    await expect
      .element(page.getByText("Support for Forgejo / Gitea is coming soon."))
      .toBeVisible();
    const github = page.getByRole("switch", { name: "Use GitHub" });
    await expect.element(github).toBeChecked();

    await github.click();

    await expect.element(github).not.toBeChecked();
    expect(saved).toEqual([{ kind: "github", enabled: false }]);
  });

  it("explains how to install Git and the GitHub CLI and keeps GitHub off until then", async () => {
    await render(<SourceControlSettings />, {
      environment: {
        requests: fakeRequests(
          respond(SourceControlApi.discover, async () =>
            sourceControlDiscovery({
              git: { _tag: "Missing" },
              github: { _tag: "Missing", kind: "github", enabled: true },
            }),
          ),
        ),
      },
    });

    await expect
      .element(page.getByText(/Install Git from https:\/\/git-scm\.com/))
      .toBeVisible();
    await expect
      .element(page.getByText(/Install the GitHub command-line tool/))
      .toBeVisible();
    await expect
      .element(page.getByRole("switch", { name: "Use GitHub" }))
      .toBeDisabled();
  });

  it("saves an Atlassian API token from the Bitbucket row and says inline why one was refused", async () => {
    let saved: BitbucketToken | null = null;
    const sent: unknown[] = [];
    await render(<SourceControlSettings />, {
      environment: {
        requests: fakeRequests(
          respond(SourceControlApi.discover, async () =>
            sourceControlDiscovery({
              bitbucket: {
                _tag: "Token",
                kind: "bitbucket",
                enabled: true,
                saved,
              },
            }),
          ),
          respond(SourceControlApi.saveBitbucketToken, async (input) => {
            sent.push(input);
            if (input.token === "wrong")
              throw rejected({
                _tag: "BitbucketTokenRejected",
                reason: "Invalid",
              });
            saved = {
              _tag: "ApiToken",
              email: "octo@example.com",
              account: "octo",
            };
          }),
        ),
      },
    });
    const bitbucket = page.getByRole("switch", { name: "Use Bitbucket" });
    await expect.element(bitbucket).toBeDisabled();

    await page.getByRole("tab", { name: "API token" }).click();
    await page.getByRole("button", { name: "four read scopes" }).hover();
    await expect
      .element(page.getByRole("list", { name: "Required scopes" }))
      .toHaveTextContent(
        "read:repository:bitbucketread:pullrequest:bitbucketread:user:bitbucketread:workspace:bitbucket",
      );
    await page
      .getByLabelText("Atlassian account email")
      .fill(" octo@example.com ");
    await page.getByRole("textbox", { name: "API token" }).fill("wrong");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .element(
        page.getByText("Bitbucket did not accept this email and API token."),
      )
      .toBeVisible();

    await page.getByRole("textbox", { name: "API token" }).fill("api-token");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .element(
        page.getByRole("button", { name: "Show account on bitbucket.org" }),
      )
      .toBeVisible();
    await expect.element(bitbucket).toBeChecked();
    await expect
      .element(page.getByRole("textbox", { name: "API token" }))
      .not.toBeInTheDocument();
    expect(sent).toEqual([
      { _tag: "ApiToken", email: "octo@example.com", token: "wrong" },
      { _tag: "ApiToken", email: "octo@example.com", token: "api-token" },
    ]);
  });
});
