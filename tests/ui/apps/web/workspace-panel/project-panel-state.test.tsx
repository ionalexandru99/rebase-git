import { beforeEach, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { ResizablePanel } from "#web-ui/components/ui/resizable";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/workspace-panel-provider";

vi.mock(
  "#web/features/workspace-panel/workspace-panel-definitions",
  async (original) => {
    const module =
      await original<
        typeof import("#web/features/workspace-panel/workspace-panel-definitions")
      >();
    return {
      ...module,
      workspacePanelDefinitions: {
        ...module.workspacePanelDefinitions,
        code: {
          ...module.workspacePanelDefinitions.code,
          available: true,
          launchable: false,
        },
        "pull-request": {
          ...module.workspacePanelDefinitions["pull-request"],
          available: true,
          launchable: false,
        },
      },
    };
  },
);

beforeEach(() => localStorage.clear());

it("restores all open panel tabs after leaving a project and collapsing its panel", async () => {
  const tree = (project: string) => (
    <div style={{ width: 1000, height: 600 }}>
      <WorkspacePanel.Provider key={project} scopeKey={project}>
        <WorkspacePanel.Group>
          <ResizablePanel id="graph" minSize="20%">
            <WorkspacePanel.Toggle />
            <Inspect />
          </ResizablePanel>
          <WorkspacePanel.Pane />
        </WorkspacePanel.Group>
      </WorkspacePanel.Provider>
    </div>
  );
  const view = await render(tree("project-a"));
  await page.getByRole("button", { name: "Show side panel" }).click();
  await page
    .getByRole("button", { name: "Diffs Review and commit working changes" })
    .click();
  await page.getByRole("button", { name: "Inspect" }).click();
  await page.getByRole("button", { name: "Review pull request" }).click();
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect
    .element(page.getByRole("tab", { name: "Code", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Hide side panel" }).click();

  await view.rerender(tree("project-b"));
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect
    .element(page.getByRole("heading", { name: "Open a tab" }))
    .toBeVisible();

  await view.rerender(tree("project-a"));
  await expect
    .element(page.getByRole("complementary", { name: "Side panel" }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect
    .element(page.getByRole("tab", { name: "Code", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect.element(page.getByRole("tab", { name: "Diffs" })).toBeVisible();
  await expect
    .element(page.getByRole("tab", { name: "Pull requests", exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Close Code tab" }).click();
  await view.rerender(tree("project-b"));
  await view.rerender(tree("project-a"));
  await expect
    .element(page.getByRole("tab", { name: "Code", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("tab", { name: "Pull requests", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect.element(page.getByRole("tab", { name: "Diffs" })).toBeVisible();
});

function Inspect() {
  const panel = useWorkspacePanel();
  return (
    <>
      <button
        type="button"
        onClick={() => panel.execute({ type: "open", kind: "code" })}
      >
        Inspect
      </button>
      <button
        type="button"
        onClick={() => panel.execute({ type: "open", kind: "pull-request" })}
      >
        Review pull request
      </button>
    </>
  );
}
