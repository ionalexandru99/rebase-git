import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { createWorkspacePanelStore } from "#web/features/workspace-panel/persistence/workspace-panel-store.ts";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";

describe("workspace panel", () => {
  beforeEach(() => localStorage.clear());

  it("expands across the graph while keeping branches visible and restores its width", async () => {
    await render(
      <div className="dark" style={{ width: 1600, height: 600 }}>
        <WorkspacePanel.Provider scopeKey="expanded">
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
        </WorkspacePanel.Provider>
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

  it("marks the closed panel toggle while there are uncommitted changes", async () => {
    await render(
      <div className="dark" style={{ width: 1200, height: 600 }}>
        <WorkspacePanel.Provider scopeKey="uncommitted">
          <WorkspacePanel.Controls uncommitted />
          <WorkspacePanel.Group>
            <WorkspacePanel.Sidebar />
            <WorkspacePanel.Main>{() => null}</WorkspacePanel.Main>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        </WorkspacePanel.Provider>
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
  });

  it("keeps the panel toggle in one place and hides the panel while it is expanded", async () => {
    await render(
      <div className="dark" style={{ width: 1200, height: 600 }}>
        <WorkspacePanel.Provider scopeKey="pinned">
          <WorkspacePanel.Controls />
          <WorkspacePanel.Group>
            <WorkspacePanel.Sidebar />
            <WorkspacePanel.Main>{() => null}</WorkspacePanel.Main>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        </WorkspacePanel.Provider>
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
    localStorage.setItem(
      "rebase:workspace-panel:v1:saved",
      JSON.stringify({
        tabs: ["changes", "code"],
        active: "code",
        open: false,
        widths: { sidebar: 16, panel: 30 },
      }),
    );
    await renderPanel("saved");
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Diffs" }))
      .toBeVisible();
    await expect.poll(panelWidth).toBeCloseTo(480, -1);
  });

  it("keeps each project's tabs and visibility when switching projects and reopening the panel", async () => {
    const panel = await renderPanel("project-a");
    await page.getByRole("button", { name: "Show side panel" }).click();
    await page
      .getByRole("button", { name: "Diffs Review and commit working changes" })
      .click();
    await expect
      .element(page.getByRole("tab", { name: "Diffs" }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Hide side panel" }).click();

    await panel.switchScope("project-b");
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Open a tab" }))
      .toBeVisible();

    await panel.switchScope("project-a");
    await expect
      .element(page.getByRole("complementary", { name: "Side panel" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Diffs" }))
      .toHaveAttribute("aria-selected", "true");

    await panel.switchScope("project-b");
    await expect
      .element(page.getByRole("heading", { name: "Open a tab" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("tab", { name: "Diffs" }))
      .not.toBeInTheDocument();
  });

  it("restores the panel width when switching worktrees with the graph mounted", async () => {
    createWorkspacePanelStore("first").dispatch({
      type: "resize",
      widths: { sidebar: 16, panel: 22 },
    });
    createWorkspacePanelStore("other").dispatch({
      type: "resize",
      widths: { sidebar: 16, panel: 30 },
    });
    const panel = await renderPanel("first");
    await page.getByRole("button", { name: "Show side panel" }).click();
    const graph = page
      .getByRole("button", { name: "Graph selection" })
      .element();
    await expect.poll(panelWidth).toBeCloseTo(352, -1);
    await panel.switchScope("other");
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(480, -1);
    await panel.switchScope("first");
    await expect.poll(panelWidth).toBeCloseTo(352, -1);
    expect(
      page.getByRole("button", { name: "Graph selection" }).element(),
    ).toBe(graph);
  });

  it("keeps widths in rem across window sizes and saves only the resized panel", async () => {
    const panel = await renderPanel("window", 1600);
    await page.getByRole("button", { name: "Show side panel" }).click();
    await expect.poll(panelWidth).toBeCloseTo(576, -1);
    await expect.poll(sidebarWidth).toBeCloseTo(256, -1);
    await panel.resize(1200);
    await expect.poll(sidebarWidth).toBeLessThan(250);
    await page.getByRole("separator", { name: "Resize side panel" }).click();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => savedWidths("window").panel).toBeLessThan(26);
    expect(savedWidths("window").sidebar).toBe(16);
    const saved = savedWidths("window").panel * 16;
    await panel.resize(2400);
    await expect.poll(sidebarWidth).toBeCloseTo(256, -1);
    await expect.poll(panelWidth).toBeCloseTo(saved, -1);
  });
});

function sidebarWidth() {
  return page.getByTestId("branches").element().getBoundingClientRect().width;
}

function savedWidths(scopeKey: string) {
  return JSON.parse(
    localStorage.getItem(`rebase:workspace-panel:v1:${scopeKey}`) ?? "{}",
  ).widths;
}

function panelWidth() {
  return page
    .getByRole("complementary", { name: "Side panel" })
    .element()
    .getBoundingClientRect().width;
}

async function renderPanel(scopeKey = "panel-test", width = 1600) {
  const tree = (scopeKey: string, width: number) => (
    <div className="dark" style={{ width, height: 600 }}>
      <WorkspacePanel.Provider scopeKey={scopeKey}>
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
  let current = { scopeKey, width };
  const view = await render(tree(scopeKey, width));
  const show = (next: typeof current) => {
    current = next;
    return view.rerender(tree(next.scopeKey, next.width));
  };
  return {
    view,
    switchScope: (next: string) => show({ ...current, scopeKey: next }),
    resize: (next: number) => show({ ...current, width: next }),
  };
}

it("migrates a shared previous layout into only the first repository", async () => {
  localStorage.clear();
  const scopeKey = JSON.stringify(["environment", "logical", "/repo"]);
  const storageKey = `rebase:workspace-panel:v1:${scopeKey}`;
  const saved = {
    tabs: ["changes", "commit"],
    active: "commit",
    open: true,
    widths: { sidebar: 16, panel: 30 },
  };
  localStorage.setItem(storageKey, JSON.stringify(saved));
  const tree = (repositoryId: string) => (
    <div style={{ width: 1600, height: 600 }}>
      <WorkspacePanel.Provider
        key={repositoryId}
        scopeKey={scopeKey}
        scope={{
          environmentId: "environment",
          repositoryId,
          logicalRepositoryId: "logical",
          worktreePath: "/repo",
        }}
      >
        <WorkspacePanel.Controls />
        <WorkspacePanel.Group>
          <WorkspacePanel.Sidebar />
          <WorkspacePanel.Main>{() => null}</WorkspacePanel.Main>
          <WorkspacePanel.Pane />
        </WorkspacePanel.Group>
      </WorkspacePanel.Provider>
    </div>
  );
  const view = await render(tree("project-a"));
  await expect
    .element(page.getByRole("tab", { name: "Commit", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect
    .element(page.getByRole("tab", { name: "Diffs", exact: true }))
    .toBeVisible();
  await expect.poll(panelWidth).toBeCloseTo(480, -1);
  await page.getByRole("button", { name: "Close Commit tab" }).click();
  await page.getByRole("button", { name: "Hide side panel" }).click();
  await view.rerender(tree("project-b"));
  await expect
    .element(page.getByRole("button", { name: "Show side panel" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect
    .element(page.getByRole("heading", { name: "Open a tab" }))
    .toBeVisible();
  expect(JSON.parse(localStorage.getItem(storageKey) ?? "null")).toEqual(saved);
  localStorage.setItem(
    storageKey,
    JSON.stringify({ ...saved, widths: { sidebar: 16, panel: 22 } }),
  );
  await view.rerender(tree("project-a"));
  await expect
    .element(page.getByRole("complementary", { name: "Side panel" }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect
    .element(page.getByRole("tab", { name: "Commit", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("tab", { name: "Diffs", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect.poll(panelWidth).toBeCloseTo(480, -1);
  await view.rerender(tree("project-b"));
  await expect
    .element(page.getByRole("heading", { name: "Open a tab" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("tab", { name: "Commit", exact: true }))
    .not.toBeInTheDocument();
});

it("does not copy an old layout after another repository already migrated it", () => {
  localStorage.clear();
  const previousScopeKey = JSON.stringify(["environment", "logical", "/repo"]);
  localStorage.setItem(
    `rebase:workspace-panel:v1:${previousScopeKey}`,
    JSON.stringify({
      tabs: ["changes"],
      active: "changes",
      open: true,
    }),
  );
  createWorkspacePanelStore(
    JSON.stringify(["environment", "project-a", "logical", "/repo"]),
  ).dispatch({ type: "open", kind: "changes" });

  const other = createWorkspacePanelStore(
    JSON.stringify(["environment", "project-b", "logical", "/repo"]),
    previousScopeKey,
  ).getSnapshot();
  expect(other.tabs).toEqual([]);
  expect(other.open).toBe(false);
});

it("leaves a previous layout unclaimed when repository storage fails", () => {
  localStorage.clear();
  const previousScopeKey = JSON.stringify(["environment", "logical", "/repo"]);
  localStorage.setItem(
    `rebase:workspace-panel:v1:${previousScopeKey}`,
    JSON.stringify({
      tabs: ["changes"],
      active: "changes",
      open: true,
    }),
  );
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
  try {
    const first = createWorkspacePanelStore(
      JSON.stringify(["environment", "project-a", "logical", "/repo"]),
      previousScopeKey,
    ).getSnapshot();
    expect(first.tabs).toEqual([]);
    expect(first.open).toBe(false);
  } finally {
    write.mockRestore();
  }
});
