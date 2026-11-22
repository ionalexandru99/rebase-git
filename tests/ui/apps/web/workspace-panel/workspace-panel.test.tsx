import { beforeEach, describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import {
  savedWorkspacePanel,
  saveWorkspacePanel,
  TestWorkspacePanel,
  workspacePanelScope,
} from "#tests-support/workspace-panel.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import type { WorkspacePanelScope } from "#web/features/workspace-panel/workspace-panel-session.ts";

describe("workspace panel", () => {
  beforeEach(() => localStorage.clear());

  it("expands across the graph while keeping branches visible and restores its width", async () => {
    await render(
      <div className="dark" style={{ width: 1600, height: 600 }}>
        <TestWorkspacePanel>
          <WorkspacePanel.Controls />
          <WorkspacePanel.Group>
            <WorkspacePanel.Sidebar>
              <div data-testid="branch-content">Branches</div>
            </WorkspacePanel.Sidebar>
            <WorkspacePanel.Main>
              {() => (
                <button type="button" data-testid="graph">
                  Graph
                </button>
              )}
            </WorkspacePanel.Main>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        </TestWorkspacePanel>
      </div>,
    );
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(576, -1);
    const graph = document.querySelector('[data-testid="graph"]');
    await page.getByRole("button", { name: "Expand side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(1342, -1);
    await expect.element(page.getByTestId("branch-content")).toBeVisible();
    expect(document.querySelector('[data-testid="graph"]')).toBe(graph);
    await page.getByRole("button", { name: "Restore side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(576, -1);
    await expect.element(page.getByTestId("graph")).toBeVisible();
  });

  it("marks the closed panel toggle and then the Diffs card while there are uncommitted changes", async () => {
    await render(
      <div className="dark" style={{ width: 1200, height: 600 }}>
        <TestWorkspacePanel>
          <WorkspacePanel.Controls uncommitted />
          <WorkspacePanel.Group>
            <WorkspacePanel.Sidebar />
            <WorkspacePanel.Main>{() => null}</WorkspacePanel.Main>
            <WorkspacePanel.Pane uncommitted />
          </WorkspacePanel.Group>
        </TestWorkspacePanel>
      </div>,
    );
    await page
      .getByRole("button", {
        name: "Show side panel, uncommitted changes",
        exact: true,
      })
      .click();
    await expect
      .element(
        page.getByRole("button", { name: "Hide side panel", exact: true }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByRole("button", {
          name: "Diffs uncommitted changes Review and commit working changes",
          exact: true,
        }),
      )
      .toBeVisible();
  });

  it("keeps the panel toggle in one place and hides the panel while it is expanded", async () => {
    await render(
      <div className="dark" style={{ width: 1200, height: 600 }}>
        <TestWorkspacePanel>
          <WorkspacePanel.Controls />
          <WorkspacePanel.Group>
            <WorkspacePanel.Sidebar />
            <WorkspacePanel.Main>{() => null}</WorkspacePanel.Main>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        </TestWorkspacePanel>
      </div>,
    );
    const place = () => {
      const { right, top } = page
        .getByRole("button", { name: /side panel$/, expanded: true })
        .or(page.getByRole("button", { name: "Show side panel" }))
        .element()
        .getBoundingClientRect();
      return `${right},${top}`;
    };
    const closed = place();
    await page.getByRole("button", { name: "Show side panel" }).click();
    expect(place()).toBe(closed);
    await page.getByRole("button", { name: "Expand side panel" }).click();
    expect(place()).toBe(closed);
    await page.getByRole("button", { name: "Hide side panel" }).click();
    await expect
      .element(page.getByRole("complementary", { name: "Side panel" }))
      .not.toBeInTheDocument();
  });

  it("uses one toggle without remounting the graph", async () => {
    await renderPanel();
    const graph = page
      .getByRole("button", { name: "Graph selection" })
      .element();
    const panel = page.getByRole("complementary", { name: "Side panel" });
    await expect.element(panel).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Show side panel" }).click();
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

  it("restores panel preferences without reopening unknown saved tabs", async () => {
    const scope = workspacePanelScope();
    saveWorkspacePanel(scope, {
      tabs: ["changes", "code"],
      active: "code",
      open: false,
      widths: { sidebar: 16, panel: 30 },
    });
    await renderPanel(scope);
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Diffs" }))
      .toBeVisible();
    await expect.poll(panelWidth).toBeCloseTo(480, -1);
  });

  it("keeps each project's tabs and visibility when switching projects and reopening the panel", async () => {
    const projectA = workspacePanelScope();
    const projectB = workspacePanelScope();
    const panel = await renderPanel(projectA);
    await page.getByRole("button", { name: "Show side panel" }).click();
    await page
      .getByRole("button", { name: "Diffs Review and commit working changes" })
      .click();
    await expect
      .element(page.getByRole("tab", { name: "Diffs" }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Hide side panel" }).click();

    await panel.switchScope(projectB);
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Open a tab" }))
      .toBeVisible();

    await panel.switchScope(projectA);
    await expect
      .element(page.getByRole("complementary", { name: "Side panel" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Diffs" }))
      .toHaveAttribute("aria-selected", "true");

    await panel.switchScope(projectB);
    await expect
      .element(page.getByRole("heading", { name: "Open a tab" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("tab", { name: "Diffs" }))
      .not.toBeInTheDocument();
  });

  it("restores the panel width when switching worktrees with the graph mounted", async () => {
    const first = workspacePanelScope({ worktreePath: "/first" });
    const other = { ...first, worktreePath: "/other" };
    saveWorkspacePanel(first, { tabs: [], widths: { sidebar: 16, panel: 22 } });
    saveWorkspacePanel(other, { tabs: [], widths: { sidebar: 16, panel: 30 } });
    const panel = await renderPanel(first);
    await page.getByRole("button", { name: "Show side panel" }).click();
    const graph = page
      .getByRole("button", { name: "Graph selection" })
      .element();
    await expect.poll(panelWidth).toBeCloseTo(352, -1);
    await panel.switchScope(other);
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(480, -1);
    await panel.switchScope(first);
    await expect.poll(panelWidth).toBeCloseTo(352, -1);
    expect(
      page.getByRole("button", { name: "Graph selection" }).element(),
    ).toBe(graph);
  });

  it("keeps widths in rem across window sizes and saves only the resized panel", async () => {
    const scope = workspacePanelScope();
    const panel = await renderPanel(scope, 1600);
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(576, -1);
    await expect.poll(sidebarWidth).toBeCloseTo(256, -1);
    await panel.resize(1200);
    await expect.poll(sidebarWidth).toBeLessThan(250);
    await page.getByRole("separator", { name: "Resize side panel" }).click();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => savedWidths(scope).panel).toBeLessThan(36);
    expect(savedWidths(scope).sidebar).toBe(16);
    const saved = savedWidths(scope).panel * 16;
    await panel.resize(2400);
    await expect.poll(sidebarWidth).toBeCloseTo(256, -1);
    await expect.poll(panelWidth).toBeCloseTo(saved, -1);
  });
});

function sidebarWidth() {
  return page.getByTestId("branches").element().getBoundingClientRect().width;
}

function savedWidths(scope: WorkspacePanelScope) {
  const saved = savedWorkspacePanel(scope);
  return saved !== null && typeof saved === "object" && "widths" in saved
    ? (saved.widths as { sidebar: number; panel: number })
    : { sidebar: 0, panel: 0 };
}

function panelWidth() {
  return page
    .getByRole("complementary", { name: "Side panel" })
    .element()
    .getBoundingClientRect().width;
}

async function renderPanel(scope = workspacePanelScope(), width = 1600) {
  const tree = (scope: WorkspacePanelScope, width: number) => (
    <div className="dark" style={{ width, height: 600 }}>
      <WorkspacePanel.Provider scope={scope}>
        <WorkspacePanel.Controls />
        <WorkspacePanel.Group>
          <WorkspacePanel.Sidebar />
          <WorkspacePanel.Main>
            {() => <button type="button">Graph selection</button>}
          </WorkspacePanel.Main>
          <WorkspacePanel.Pane />
        </WorkspacePanel.Group>
      </WorkspacePanel.Provider>
    </div>
  );
  let current = { scope, width };
  const view = await render(tree(scope, width), {
    wrapper: WorkspacePanel.Sessions,
  });
  const show = (next: typeof current) => {
    current = next;
    return view.rerender(tree(next.scope, next.width));
  };
  return {
    view,
    switchScope: (next: WorkspacePanelScope) =>
      show({ ...current, scope: next }),
    resize: (next: number) => show({ ...current, width: next }),
  };
}
