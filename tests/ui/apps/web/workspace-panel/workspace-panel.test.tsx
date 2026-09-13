import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { createWorkspacePanelStore } from "#web/features/workspace-panel/persistence/workspace-panel-store";
import { ResizablePanel } from "#web-ui/components/ui/resizable";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";

describe("workspace panel", () => {
  beforeEach(() => localStorage.clear());

  it("expands across the graph while keeping branches visible and restores its width", async () => {
    await render(
      <div className="dark" style={{ width: 1200, height: 600 }}>
        <WorkspacePanel.Provider scopeKey="expanded">
          <WorkspacePanel.Group>
            <ResizablePanel id="branches" defaultSize="20%" minSize="15%">
              <div data-testid="branch-content">Branches</div>
            </ResizablePanel>
            <WorkspacePanel.Main>
              {() => (
                <>
                  <WorkspacePanel.Toggle />
                  <button type="button" data-testid="graph">
                    Graph
                  </button>
                </>
              )}
            </WorkspacePanel.Main>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        </WorkspacePanel.Provider>
      </div>,
    );
    await page.getByRole("button", { name: "Show side panel" }).click();
    const width = panelWidth();
    const graph = document.querySelector('[data-testid="graph"]');
    await page.getByRole("button", { name: "Expand side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(960, -1);
    await expect.element(page.getByTestId("branch-content")).toBeVisible();
    expect(document.querySelector('[data-testid="graph"]')).toBe(graph);
    await page.getByRole("button", { name: "Restore side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(width, -1);
    await expect.element(page.getByTestId("graph")).toBeVisible();
  });

  it("shows unavailable features as disabled and uses one toggle without remounting the graph", async () => {
    await renderPanel();
    const graph = page
      .getByRole("button", { name: "Graph selection" })
      .element();
    const panel = page.getByRole("complementary", { name: "Side panel" });
    await expect.element(panel).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Show side panel" }).click();
    for (const name of ["Code", "Pull requests"]) {
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
      .element(page.getByRole("tab", { name: "Diffs" }))
      .toBeVisible();
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
  const tree = (scopeKey: string) => (
    <div className="dark" style={{ width: 1000, height: 600 }}>
      <WorkspacePanel.Provider scopeKey={scopeKey}>
        <WorkspacePanel.Group>
          <ResizablePanel id="graph" minSize="20%">
            <WorkspacePanel.Toggle />
            <button type="button">Graph selection</button>
          </ResizablePanel>
          <WorkspacePanel.Pane />
        </WorkspacePanel.Group>
      </WorkspacePanel.Provider>
    </div>
  );
  const view = await render(tree(scopeKey));
  return {
    view,
    switchScope: (next: string) => view.rerender(tree(next)),
  };
}
