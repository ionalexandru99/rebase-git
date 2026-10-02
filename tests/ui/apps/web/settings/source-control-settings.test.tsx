import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
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
      .element(page.getByText("Support for Bitbucket is coming soon."))
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
});
