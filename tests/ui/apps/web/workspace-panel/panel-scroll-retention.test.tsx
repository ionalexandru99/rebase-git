import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { ResizablePanel } from "#web-ui/components/ui/resizable";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";

it("retains nested scroll coordinates when detached views are shown again", async () => {
  localStorage.clear();
  for (const project of ["scroll-a", "scroll-b"]) {
    localStorage.setItem(
      `rebase:workspace-panel:v1:${project}`,
      JSON.stringify({
        tabs: ["changes"],
        active: "changes",
        open: true,
        width: 55,
      }),
    );
  }
  const tree = (project: string, repositoryIds = ["scroll-a", "scroll-b"]) => (
    <div style={{ width: 1000, height: 600 }}>
      <WorkspacePanel.Sessions repositoryIds={repositoryIds}>
        <WorkspacePanel.Provider
          key={project}
          scopeKey={project}
          scope={{
            environmentId: "environment",
            repositoryId: project,
            logicalRepositoryId: project,
            worktreePath: `/repo/${project}`,
          }}
        >
          <WorkspacePanel.Group>
            <ResizablePanel id="graph" minSize="20%">
              <WorkspacePanel.Toggle />
            </ResizablePanel>
            <WorkspacePanel.Pane
              contents={{
                changes: (
                  <div
                    data-testid={`outer-${project}`}
                    style={{ height: 240, width: 300, overflow: "auto" }}
                  >
                    <div style={{ height: 1200, width: 1200, padding: 20 }}>
                      <div
                        data-testid={`inner-${project}`}
                        style={{ height: 100, width: 150, overflow: "auto" }}
                      >
                        <div style={{ height: 900, width: 900 }}>
                          Scrollable panel content
                        </div>
                      </div>
                    </div>
                  </div>
                ),
              }}
            />
          </WorkspacePanel.Group>
        </WorkspacePanel.Provider>
      </WorkspacePanel.Sessions>
    </div>
  );
  const view = await render(tree("scroll-a"));
  const outer = page.getByTestId("outer-scroll-a").element() as HTMLElement;
  const inner = page.getByTestId("inner-scroll-a").element() as HTMLElement;
  const shadowHost = document.createElement("div");
  outer.firstElementChild?.append(shadowHost);
  const shadow = shadowHost.attachShadow({ mode: "open" });
  const shadowScroller = document.createElement("div");
  shadowScroller.style.cssText = "width:100px;height:80px;overflow:auto";
  const shadowContent = document.createElement("div");
  shadowContent.style.cssText = "width:900px;height:900px";
  shadowScroller.append(shadowContent);
  shadow.append(shadowScroller);
  shadowScroller.scrollTop = 63;
  shadowScroller.scrollLeft = 29;
  outer.scrollTop = 137;
  outer.scrollLeft = 89;
  inner.scrollTop = 71;
  inner.scrollLeft = 43;
  const positions = () => [
    outer.scrollTop,
    outer.scrollLeft,
    inner.scrollTop,
    inner.scrollLeft,
  ];
  expect(positions()).toEqual([137, 89, 71, 43]);
  await page.getByRole("button", { name: "Hide side panel" }).click();
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect.poll(positions).toEqual([137, 89, 71, 43]);
  expect(page.getByTestId("outer-scroll-a").element()).toBe(outer);
  expect([shadowScroller.scrollTop, shadowScroller.scrollLeft]).toEqual([
    63, 29,
  ]);
  await view.rerender(tree("scroll-b"));
  const other = page.getByTestId("outer-scroll-b").element() as HTMLElement;
  expect(other.scrollTop).toBe(0);
  other.scrollTop = 222;
  other.scrollLeft = 111;
  await view.rerender(tree("scroll-a"));
  await expect.poll(positions).toEqual([137, 89, 71, 43]);
  expect(page.getByTestId("inner-scroll-a").element()).toBe(inner);
  expect([shadowScroller.scrollTop, shadowScroller.scrollLeft]).toEqual([
    63, 29,
  ]);
  await view.rerender(tree("scroll-b"));
  expect([other.scrollTop, other.scrollLeft]).toEqual([222, 111]);
  await page.getByRole("button", { name: "Close Diffs tab" }).click();
  await page
    .getByRole("button", { name: "Diffs Review and commit working changes" })
    .click();
  const reopened = page.getByTestId("outer-scroll-b").element() as HTMLElement;
  expect(reopened).not.toBe(other);
  expect([reopened.scrollTop, reopened.scrollLeft]).toEqual([0, 0]);
  await view.rerender(tree("scroll-b", ["scroll-b"]));
  await view.rerender(tree("scroll-a"));
  const recreated = page.getByTestId("outer-scroll-a").element() as HTMLElement;
  expect(recreated).not.toBe(outer);
  expect([recreated.scrollTop, recreated.scrollLeft]).toEqual([0, 0]);
});
