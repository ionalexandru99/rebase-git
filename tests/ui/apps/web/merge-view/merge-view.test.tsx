import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  content,
  firstMarker,
  initialContent,
  mergeViewFixture,
  path,
  secondMarker,
} from "#tests-ui/apps/web/merge-view/merge-view-fixture";

const box = (side: "Current" | "Incoming" | "Base", line: number, region = 1) =>
  page.getByRole("button", {
    name: `${side} line ${line}, region ${region}`,
    exact: true,
  });
const result = () => page.getByRole("textbox", { name: "Result" });

async function opened() {
  const fixture = await mergeViewFixture();
  await expect.element(box("Current", 1)).toBeVisible();
  return fixture;
}

async function typeAt(offset: number, text: string) {
  const area = result().element() as HTMLTextAreaElement;
  area.focus();
  area.setSelectionRange(offset, offset);
  await userEvent.keyboard(text);
}

describe("merge view", () => {
  it("aligns both sides so each region is one padded band", async () => {
    await opened();
    const rows = (side: string, kind = "") =>
      document.querySelectorAll(
        `[data-pane="${side}"] [data-row${kind === "" ? "" : `="${kind}"`}]`,
      );
    expect(rows("current").length).toBe(rows("incoming").length);
    expect(rows("current", "padding")).toHaveLength(0);
    expect(rows("incoming", "padding")).toHaveLength(1);
    await expect
      .element(page.getByText("2 of 2 open", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Move retries into config"))
      .toBeVisible();
  });

  it("writes the region block with a single clicked line", async () => {
    const f = await opened();
    await box("Current", 2).click();
    await expect.element(box("Current", 2)).toHaveTextContent("1");
    await expect
      .element(box("Current", 2))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => f.writes.at(-1)?.content)
      .toBe(content(["  delay: 100,"]));
    expect(f.writes.at(-1)?.revision).toBe("revision-0");
    await expect
      .element(page.getByText("1 of 2 open", { exact: true }))
      .toBeVisible();
  });

  it("selects a dragged range in drag order", async () => {
    const f = await opened();
    await box("Current", 2).dropTo(box("Current", 1));
    await expect
      .poll(() => f.text())
      .toBe(content(["  delay: 100,", "  retries: 3,"]));
    await expect.element(box("Current", 2)).toHaveTextContent("1");
    await expect.element(box("Current", 1)).toHaveTextContent("2");
  });

  it("interleaves alternating clicks across sides and renumbers after a removal", async () => {
    const f = await opened();
    await box("Current", 1).click();
    await box("Incoming", 1).click();
    await box("Current", 2).click();
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  retries: 5,", "  delay: 100,"]));
    await box("Incoming", 1).click();
    await expect.element(box("Incoming", 1)).toHaveTextContent("");
    await expect.element(box("Current", 2)).toHaveTextContent("2");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"]));
  });

  it("keeps typed text until the next selection change in that region", async () => {
    const f = await opened();
    await box("Current", 1).click();
    await expect.poll(() => f.text()).toBe(content(["  retries: 3,"]));
    const end = content(["  retries: 3,"]).indexOf("  retries: 3,") + 13;
    await typeAt(end, " // two");
    await expect.poll(() => f.text()).toBe(content(["  retries: 3, // two"]));
    await expect(result()).toHaveValue(content(["  retries: 3, // two"]));
    await box("Current", 2).click();
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"]));
  });

  it("coalesces changes made while a write is in flight", async () => {
    const f = await opened();
    f.holdWrites();
    await box("Current", 1).click();
    await expect.poll(() => f.writes.length).toBe(1);
    await box("Incoming", 1).click();
    await box("Current", 2).click();
    f.releaseWrites();
    const latest = content(["  retries: 3,", "  retries: 5,", "  delay: 100,"]);
    await expect.poll(() => f.text()).toBe(latest);
    expect(f.writes).toHaveLength(2);
    expect(f.writes[1]).toMatchObject({
      content: latest,
      revision: "revision-1",
    });
  });

  it("reloads the document on a stale write and keeps the file open", async () => {
    const f = await opened();
    f.staleOnNextWrite();
    await box("Current", 1).click();
    await expect
      .element(page.getByText("config.ts changed on disk. Reloaded."))
      .toBeVisible();
    await expect(result()).toHaveValue(
      content(["// changed on disk"], secondMarker),
    );
    expect(f.reads()).toBe(2);
    expect(f.onClose).not.toHaveBeenCalled();
    await expect
      .element(page.getByText("1 of 2 open", { exact: true }))
      .toBeVisible();
  });

  it("restores the marker block when a decided region is undone", async () => {
    const f = await opened();
    await box("Incoming", 1).click();
    await expect.poll(() => f.text()).toBe(content(["  retries: 5,"]));
    await page.getByRole("button", { name: "Undo region 1" }).click();
    await expect(result()).toHaveValue(initialContent);
    await expect.poll(() => f.text()).toBe(initialContent);
    await expect
      .element(box("Incoming", 1))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("asks before staging a file that still has markers", async () => {
    const f = await opened();
    await page
      .getByRole("button", { name: "Mark resolved", exact: true })
      .click();
    await expect
      .element(page.getByRole("button", { name: "Cancel" }))
      .toHaveFocus();
    expect(f.stages).toMatchObject([{ path, allowMarkers: false }]);
    await page.getByRole("button", { name: "Mark resolved anyway" }).click();
    await expect.poll(() => f.onClose.mock.calls.length).toBe(1);
    expect(f.stages[1]).toMatchObject({ allowMarkers: true });
  });

  it("moves to the next file with open regions after staging", async () => {
    const f = await mergeViewFixture({
      otherFiles: [
        {
          path: "src/done.ts",
          revision: "done",
          kind: "both-modified",
          stages: [],
          openRegions: 0,
          choices: [],
        },
        {
          path: "src/next.ts",
          revision: "next",
          kind: "both-modified",
          stages: [],
          openRegions: 1,
          choices: [],
        },
      ],
    });
    await box("Current", 1).click();
    await box("Incoming", 1, 2).click();
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,"], ["  return 2;"]));
    await page
      .getByRole("button", { name: "Mark resolved", exact: true })
      .click();
    await expect.poll(() => f.onOpen.mock.calls).toEqual([["src/next.ts"]]);
    expect(f.stages).toMatchObject([
      { allowMarkers: false, revision: "revision-2" },
    ]);
    expect(f.onClose).not.toHaveBeenCalled();
  });

  it("drives regions and lines from the keyboard", async () => {
    const f = await opened();
    (box("Current", 1).element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"]));
    await expect.element(box("Current", 2)).toHaveFocus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await userEvent.keyboard("{Alt>}2{/Alt}");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"], ["  return 2;"]));
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await userEvent.keyboard("{Alt>}1{/Alt}");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"], ["  return 2;"]));
    await userEvent.keyboard("{Alt>}2{/Alt}");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 5,"], ["  return 2;"]));
  });

  it("uses the same handlers for the region buttons and swaps base into the left pane", async () => {
    const f = await opened();
    await page.getByRole("button", { name: "Next region" }).click();
    await expect
      .element(page.getByRole("button", { name: "Next region" }))
      .toBeDisabled();
    await page.getByRole("button", { name: "Base", exact: true }).click();
    await box("Base", 1, 2).click();
    await expect
      .poll(() => f.text())
      .toBe(content(firstMarker, ["  return 0;"]));
    await expect.element(box("Current", 1)).not.toBeInTheDocument();
  });

  it("closes with Escape", async () => {
    const f = await opened();
    (result().element() as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");
    expect(f.onClose).toHaveBeenCalledOnce();
  });

  it("offers only whole-file choices when the document is too large", async () => {
    await mergeViewFixture({ documentFailure: "TooLarge", mergeTool: "meld" });
    await page.getByRole("button", { name: "Whole file" }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Use current" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: "Open in merge tool" }))
      .toBeVisible();
    await expect.element(result()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Mark resolved", exact: true }))
      .not.toBeInTheDocument();
  });
});
