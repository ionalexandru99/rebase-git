import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "#tests-ui/runtime/render";
import { SettingsPanel } from "#web/features/settings/settings-panel";

describe("settings panel", () => {
  it("shows browser update availability and navigates settings", async () => {
    const closeSettings = vi.fn();
    await renderSettings(closeSettings);

    const settings = page.getByRole("navigation", { name: "Settings" });
    await expect
      .element(page.getByRole("heading", { level: 1, name: "General" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 2, name: "About" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("combobox", { name: "Release channel" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("switch", { name: "Check automatically" }))
      .toBeDisabled();
    await expect
      .element(
        page.getByText("Update checks are available in the Electron app."),
      )
      .toBeVisible();

    const search = settings.getByRole("textbox", { name: "Search settings" });
    await search.fill("history");
    await expect
      .element(settings.getByRole("button", { name: "General", exact: true }))
      .not.toBeInTheDocument();
    await search.clear();

    await settings.getByRole("button", { name: "History storage" }).click();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "History storage" }))
      .toBeVisible();
    await settings
      .getByRole("button", { name: "General", exact: true })
      .click();
    await expect
      .element(page.getByRole("combobox", { name: "Release channel" }))
      .toHaveTextContent("Stable");

    await settings.getByRole("button", { name: "Back" }).click();
    expect(closeSettings).toHaveBeenCalledOnce();
  });

  it("keeps settings content inside a narrow viewport", async () => {
    await page.viewport(640, 720);
    await renderSettings(vi.fn());

    const content = page
      .getByRole("main", { name: "Settings content" })
      .element();

    expect(content.scrollWidth).toBe(content.clientWidth);
  });
});

async function renderSettings(closeSettings: () => void) {
  return render(
    <SettingsPanel
      closeSettings={closeSettings}
      desktopUpdates={undefined}
      productVersion="0.0.2-test"
    />,
  );
}
