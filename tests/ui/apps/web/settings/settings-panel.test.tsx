import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { browserKeyboardShortcutHost } from "#web/features/keyboard-shortcuts/browser-keyboard-shortcut-host";
import { createKeyboardShortcutStore } from "#web/features/keyboard-shortcuts/keyboard-shortcut-store";
import { KeyboardShortcutsProvider } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import { SettingsPanel } from "#web-ui/features/settings/settings-panel";

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
    await search.fill("keyboard");
    await expect
      .element(settings.getByRole("button", { name: "General", exact: true }))
      .not.toBeInTheDocument();
    await search.clear();

    await settings.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect
      .element(
        page.getByRole("heading", { level: 1, name: "Keyboard shortcuts" }),
      )
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
  const runtime = {
    host: browserKeyboardShortcutHost(),
    store: createKeyboardShortcutStore(memoryStorage()),
  };
  return render(
    <KeyboardShortcutsProvider runtime={runtime}>
      <SettingsPanel
        closeSettings={closeSettings}
        desktopUpdates={undefined}
        productVersion="0.0.2-test"
      />
    </KeyboardShortcutsProvider>,
  );
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
