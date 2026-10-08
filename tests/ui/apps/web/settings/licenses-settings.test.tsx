import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { thirdPartyLicense } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { LicensesSettings } from "#web/features/settings/licenses-settings.tsx";

describe("licenses settings", () => {
  it("searches notices and opens the one the user picks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([
        thirdPartyLicense(),
        thirdPartyLicense({
          name: "Symbols Nerd Font Mono",
          version: null,
          sourceUrl: null,
          notice: "Copyright (c) 2014 Ryan L McIntyre",
        }),
      ]),
    );
    await render(<LicensesSettings />);

    const react = page.getByRole("button", { name: /react/ });
    await page.getByRole("searchbox", { name: "Search licenses" }).fill("nerd");
    await expect.element(react).not.toBeInTheDocument();

    await page.getByRole("button", { name: /Symbols Nerd Font Mono/ }).click();
    await expect
      .element(page.getByText("Copyright (c) 2014 Ryan L McIntyre"))
      .toBeVisible();

    await page.getByRole("searchbox", { name: "Search licenses" }).fill("");
    await expect
      .element(page.getByRole("link", { name: "react source" }))
      .toHaveAttribute("href", "https://github.com/facebook/react");
  });
});
