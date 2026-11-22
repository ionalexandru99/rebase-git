import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  type PullStrategy,
  PullStrategyApi,
  type RepositoryPullStrategy,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { render } from "#tests-support/render.tsx";
import { pullStrategySetting } from "#web/features/remote-sync/sync-settings.ts";
import {
  RepositorySettingSelect,
  ServerSettingSelect,
} from "#web/features/settings/setting-rows.tsx";

const repositoryId = "00000000-0000-4000-8000-000000000042";

describe("diverged pull settings", () => {
  it("saves the server value chosen in the select", async () => {
    let strategy: PullStrategy = "ask";
    const saved: unknown[] = [];
    await render(<ServerSettingSelect setting={pullStrategySetting} />, {
      environment: {
        requests: fakeRequests(
          respond(PullStrategyApi.read, async () => strategy),
          respond(PullStrategyApi.save, async (input) => {
            saved.push(input);
            strategy = input.value;
            return strategy;
          }),
        ),
      },
    });
    const select = page.getByRole("combobox", { name: "Diverged pull" });
    await expect.element(select).toHaveTextContent("Ask");

    await select.click();
    await page.getByRole("option", { name: "Rebase" }).click();

    await expect.element(select).toHaveTextContent("Rebase");
    expect(saved).toEqual([{ value: "rebase" }]);
  });

  it("names the server value in the default option and clears the repository value with it", async () => {
    let strategy: RepositoryPullStrategy = {
      repository: null,
      server: "merge",
    };
    const saved: unknown[] = [];
    await render(
      <RepositorySettingSelect
        repositoryId={repositoryId}
        setting={pullStrategySetting}
      />,
      {
        environment: {
          requests: fakeRequests(
            respond(PullStrategyApi.readRepository, async () => strategy),
            respond(PullStrategyApi.saveRepository, async (input) => {
              saved.push(input);
              strategy = { ...strategy, repository: input.value };
              return strategy;
            }),
          ),
        },
      },
    );
    const select = page.getByRole("combobox", { name: "Diverged pull" });
    await expect.element(select).toHaveTextContent("Default (Merge)");

    await select.click();
    await page.getByRole("option", { name: "Rebase" }).click();
    await expect.element(select).toHaveTextContent("Rebase");
    await select.click();
    await page.getByRole("option", { name: "Default (Merge)" }).click();

    await expect.element(select).toHaveTextContent("Default (Merge)");
    expect(saved).toEqual([
      { repositoryId, value: "rebase" },
      { repositoryId, value: null },
    ]);
  });
});
