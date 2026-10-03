import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
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
    const saved = await renderSettings();
    const settle = page.getByRole("switch", {
      name: "Settle merged branches",
    });
    await expect.element(settle).toBeChecked();

    await settle.click();
    await expect.element(settle).not.toBeChecked();
    await settle.click();

    await expect.element(settle).toBeChecked();
    expect(saved).toEqual([
      { ...target, autoSettle: false, deleteSettledAfter: 3 },
      { ...target, autoSettle: true, deleteSettledAfter: 3 },
    ]);
  });

  it("changes after how many days settled branches are deleted and turns deleting off", async () => {
    const saved = await renderSettings();
    const days = page.getByRole("spinbutton", {
      name: "Days before deleting settled branches",
    });
    const deleting = page.getByRole("switch", {
      name: "Delete settled branches",
    });

    await days.fill("0");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Enter a whole number from 1 to 365.");
    await days.fill("7");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(days).toHaveValue(7);
    await deleting.click();

    await expect.element(deleting).not.toBeChecked();
    await expect.element(days).toBeDisabled();
    expect(saved).toEqual([
      { ...target, autoSettle: true, deleteSettledAfter: 7 },
      { ...target, autoSettle: true, deleteSettledAfter: 0 },
    ]);
  });
});

const target = { repositoryId, worktreePath: "/repo" };

async function renderSettings() {
  let settings: Settings = { autoSettle: true, deleteSettledAfter: 3 };
  const saved: unknown[] = [];
  await render(
    <BranchSettings repositoryId={repositoryId} path="/repo" canConfigure />,
    {
      environment: {
        requests: fakeRequests(
          respond(BranchSettlingApi.settings, async () => settings),
          respond(BranchSettlingApi.saveSettings, async (input) => {
            saved.push(input);
            settings = {
              autoSettle: input.autoSettle,
              deleteSettledAfter: input.deleteSettledAfter,
            };
            return settings;
          }),
        ),
      },
    },
  );
  return saved;
}
