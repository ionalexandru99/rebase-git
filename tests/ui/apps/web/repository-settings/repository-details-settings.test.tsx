import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "#tests-support/render.tsx";
import { RepositoryDetailsSettings } from "#web/features/repository-settings/components/repository-details-settings.tsx";

describe("repository details settings", () => {
  it("shows a failed copy as a notification", async () => {
    await render(
      <RepositoryDetailsSettings
        path="/repo"
        connected
        canRemove
        copyPath={async () => {
          throw new Error("Clipboard unavailable");
        }}
        reveal={undefined}
        remove={async () => {}}
      />,
    );

    await page.getByRole("button", { name: "Copy path" }).click();

    await expect
      .element(page.getByText("Couldn't copy the path"))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Copy path" }))
      .toBeEnabled();
  });
});
