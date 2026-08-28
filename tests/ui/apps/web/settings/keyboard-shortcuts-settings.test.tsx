import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { browserKeyboardShortcutHost } from "#web/features/keyboard-shortcuts/browser-keyboard-shortcut-host";
import { createKeyboardShortcutStore } from "#web/features/keyboard-shortcuts/keyboard-shortcut-store";
import { KeyboardShortcutsProvider } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import { KeyboardShortcutsSettings } from "#web-ui/features/settings/keyboard-shortcuts-settings";

describe("keyboard shortcut settings", () => {
  it("edits, clears, and resets shortcuts", async () => {
    await renderSettings();

    const editToggle = page.getByRole("button", {
      name: "Edit Toggle Projects sidebar shortcut",
    });
    await editToggle.click();
    const capture = page.getByRole("button", { name: "Ctrl B", exact: true });
    await expect.element(capture).toHaveFocus();
    await userEvent.keyboard("{Tab}");
    await expect
      .element(page.getByRole("button", { name: "Clear" }))
      .toHaveFocus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expect.element(capture).toHaveFocus();
    await userEvent.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.element(editToggle).toHaveTextContent("Shift");
    await expect
      .element(
        page.getByRole("button", { name: "Reset Toggle Projects sidebar" }),
      )
      .toBeVisible();

    await editToggle.click();
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect.element(editToggle).toHaveTextContent("Unassigned");

    await page.getByRole("button", { name: "Reset all" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Reset all" }).click();
    await expect.element(editToggle).toHaveTextContent("Ctrl");
  });

  it("requires replacement when a shortcut conflicts", async () => {
    await renderSettings();

    await page
      .getByRole("button", {
        name: "Edit Toggle Projects sidebar shortcut",
      })
      .click();
    await userEvent.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");

    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Show Open Project currently uses Ctrl Shift O.");
    await expect
      .element(page.getByRole("button", { name: "Replace" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Save" }))
      .not.toBeInTheDocument();
  });

  it("filters commands and fixed shortcuts", async () => {
    await renderSettings();

    const search = page.getByRole("textbox", {
      name: "Search keyboard shortcuts",
    });
    await search.fill("toggle projects");

    await expect
      .element(page.getByText("Toggle Projects sidebar"))
      .toBeVisible();
    await expect
      .element(page.getByText("Open Settings"))
      .not.toBeInTheDocument();
  });
});

async function renderSettings() {
  const runtime = {
    host: browserKeyboardShortcutHost(),
    store: createKeyboardShortcutStore(memoryStorage()),
  };
  return render(
    <KeyboardShortcutsProvider runtime={runtime}>
      <KeyboardShortcutsSettings />
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
