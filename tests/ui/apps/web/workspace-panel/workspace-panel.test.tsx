import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { createKeyboardShortcutStore } from "#web/features/keyboard-shortcuts/keyboard-shortcut-store";
import { createWorkspacePanelStore } from "#web/features/workspace-panel/persistence/workspace-panel-store";
import { ResizablePanel } from "#web-ui/components/ui/resizable";
import { KeyboardShortcutsProvider } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";

describe("workspace panel", () => {
  beforeEach(() => localStorage.clear());

  it("shows unavailable features as disabled and uses one toggle without remounting the graph", async () => {
    await renderPanel();
    const graph = page
      .getByRole("button", { name: "Graph selection" })
      .element();
    const panel = page.getByRole("complementary", { name: "Side panel" });
    await expect.element(panel).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Show side panel" }).click();
    expect(panel.getByRole("button").elements()).toHaveLength(3);
    for (const name of ["Changes", "Code", "Pull requests"]) {
      await expect
        .element(page.getByRole("button", { name: `${name} Coming soon` }))
        .toBeDisabled();
    }
    await page.getByRole("button", { name: "Hide side panel" }).click();
    await expect.element(panel).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Open a tab" }))
      .toHaveFocus();
    expect(
      page.getByRole("button", { name: "Graph selection" }).element(),
    ).toBe(graph);
  });

  it("supports configurable shortcuts without activating unavailable features", async () => {
    const { shortcuts } = await renderPanel();
    await page.getByRole("button", { name: "Show side panel" }).click();
    shortcuts.setBinding("workspacePanel.toggle", {
      key: "p",
      modifiers: ["Alt", "Shift"],
    });
    shortcuts.setBinding("workspacePanel.openTab", {
      key: "o",
      modifiers: ["Alt", "Shift"],
    });
    await userEvent.keyboard("{Alt>}{Shift>}p{/Shift}{/Alt}");
    await expect
      .element(page.getByRole("button", { name: "Show side panel" }))
      .toHaveAttribute("aria-keyshortcuts", "Alt+Shift+p");
    await userEvent.keyboard("{Alt>}{Shift>}o{/Shift}{/Alt}");
    const heading = page.getByRole("heading", { name: "Open a tab" });
    await expect.element(heading).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(heading).toBeVisible();
    await expect.element(page.getByRole("tab")).not.toBeInTheDocument();
  });

  it("restores panel preferences without reopening unavailable saved tabs", async () => {
    localStorage.setItem(
      "rebase:workspace-panel:v1:saved",
      JSON.stringify({
        tabs: ["changes", "code"],
        active: "code",
        open: false,
        width: 55,
      }),
    );
    await renderPanel("saved");
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Open a tab" }))
      .toBeVisible();
    await expect.element(page.getByRole("tab")).not.toBeInTheDocument();
    await expect.poll(panelWidth).toBeCloseTo(550, -1);
  });

  it("restores the panel width when switching worktrees with the graph mounted", async () => {
    createWorkspacePanelStore("first").dispatch({ type: "resize", width: 35 });
    createWorkspacePanelStore("other").dispatch({ type: "resize", width: 55 });
    const panel = await renderPanel("first");
    await page.getByRole("button", { name: "Show side panel" }).click();
    const graph = page
      .getByRole("button", { name: "Graph selection" })
      .element();
    await expect.poll(panelWidth).toBeCloseTo(350, -1);
    await panel.switchScope("other");
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(550, -1);
    await panel.switchScope("first");
    await expect.poll(panelWidth).toBeCloseTo(350, -1);
    expect(
      page.getByRole("button", { name: "Graph selection" }).element(),
    ).toBe(graph);
  });
});

function panelWidth() {
  return page
    .getByRole("complementary", { name: "Side panel" })
    .element()
    .getBoundingClientRect().width;
}

async function renderPanel(scopeKey = "panel-test") {
  const shortcuts = createKeyboardShortcutStore(localStorage);
  const tree = (scopeKey: string) => (
    <KeyboardShortcutsProvider
      runtime={{
        host: { client: "browser", platform: "other" },
        store: shortcuts,
      }}
    >
      <div className="dark" style={{ width: 1000, height: 600 }}>
        <WorkspacePanel.Provider scopeKey={scopeKey} commandsActive>
          <WorkspacePanel.Group>
            <ResizablePanel id="graph" minSize="20%">
              <WorkspacePanel.Toggle />
              <button type="button">Graph selection</button>
            </ResizablePanel>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        </WorkspacePanel.Provider>
      </div>
    </KeyboardShortcutsProvider>
  );
  const view = await render(tree(scopeKey));
  return {
    shortcuts,
    view,
    switchScope: (next: string) => view.rerender(tree(next)),
  };
}
