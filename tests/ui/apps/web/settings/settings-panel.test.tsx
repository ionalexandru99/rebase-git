import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { DesktopUpdates } from "#contracts/desktop-updates/desktop-updates.contract.ts";
import { desktopUpdates } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { SettingsPanel } from "#web/features/settings/settings-panel.tsx";
import type { SettingsSectionId } from "#web/features/settings/settings-sections.ts";

describe("settings panel", () => {
  it("shows browser update availability and navigates settings", async () => {
    const closeSettings = vi.fn();
    await renderSettings(closeSettings);

    const settings = page.getByRole("navigation", { name: "Settings" });
    await expect
      .element(page.getByRole("heading", { level: 1, name: "General" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 3, name: "Version" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("combobox", { name: "Release channel" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Check for updates" }))
      .toHaveAccessibleDescription("Updates are managed by the desktop app.");

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
      .element(page.getByRole("heading", { level: 1, name: "General" }))
      .toBeVisible();

    await settings.getByRole("button", { name: "Back" }).click();
    expect(closeSettings).toHaveBeenCalledOnce();
  });

  it("shows a failed update check as a notification and keeps the update state", async () => {
    await renderSettings(
      vi.fn(),
      desktopUpdates({
        checkForUpdates: async () => {
          throw new Error("net::ERR_INTERNET_DISCONNECTED");
        },
      }),
    );

    await page.getByRole("button", { name: "Check for updates" }).click();

    await expect
      .element(page.getByText("Couldn't check for updates"))
      .toBeVisible();
    expect(
      page.getByText("net::ERR_INTERNET_DISCONNECTED").elements(),
    ).toHaveLength(0);
  });

  it("switches between light, dark and the system theme", async () => {
    await renderSettings(vi.fn());
    const theme = page.getByRole("combobox", { name: "Theme" });
    const root = document.documentElement;
    await expect.element(theme).toHaveTextContent("System");

    await theme.click();
    await page.getByRole("option", { name: "Dark" }).click();
    await expect.poll(() => root.classList.contains("dark")).toBe(true);

    await theme.click();
    await page.getByRole("option", { name: "Light" }).click();
    await expect.poll(() => root.classList.contains("dark")).toBe(false);

    await theme.click();
    await page.getByRole("option", { name: "System" }).click();
    await expect
      .poll(() => root.classList.contains("dark"))
      .toBe(matchMedia("(prefers-color-scheme: dark)").matches);
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

async function renderSettings(
  closeSettings: () => void,
  updates?: DesktopUpdates,
) {
  return render(
    <ControlledSettings closeSettings={closeSettings} updates={updates} />,
  );
}

function ControlledSettings({
  closeSettings,
  updates,
}: {
  readonly closeSettings: () => void;
  readonly updates: DesktopUpdates | undefined;
}) {
  const [section, setSection] = useState<SettingsSectionId>("general");
  return (
    <SettingsPanel
      closeSettings={closeSettings}
      desktopUpdates={updates}
      productVersion="0.0.2-test"
      section={section}
      selectSection={setSection}
    />
  );
}
