import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  BranchSettlingApi,
  type BranchSettings as Settings,
} from "#contracts/branch-settling/branch-settling.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { repositoryId } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { BranchSettings } from "#web/features/branch-settling/branch-settings.tsx";

describe("branch settings", () => {
  it("turns settling merged branches off and on in the repository", async () => {
    let settings: Settings = { autoSettle: true };
    const saved: unknown[] = [];
    await render(
      <BranchSettings repositoryId={repositoryId} path="/repo" canConfigure />,
      {
        environment: {
          requests: fakeRequests(
            respond(BranchSettlingApi.settings, async () => settings),
            respond(BranchSettlingApi.saveSettings, async (input) => {
              saved.push(input);
              settings = { autoSettle: input.autoSettle };
              return settings;
            }),
          ),
        },
      },
    );
    const settle = page.getByRole("switch", {
      name: "Settle merged branches",
    });
    await expect.element(settle).toBeChecked();

    await settle.click();
    await expect.element(settle).not.toBeChecked();
    await settle.click();

    await expect.element(settle).toBeChecked();
    expect(saved).toEqual([
      { repositoryId, worktreePath: "/repo", autoSettle: false },
      { repositoryId, worktreePath: "/repo", autoSettle: true },
    ]);
  });
});
