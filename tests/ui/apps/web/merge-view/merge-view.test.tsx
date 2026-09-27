import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  content,
  firstMarker,
  initialContent,
  mergeViewFixture,
  path,
} from "#tests-support/merge-view-fixture.tsx";

type Side = "Current" | "Incoming" | "Base";

const line = (side: Side, index: number, region = 1) =>
  page.getByRole("button", {
    name: `${side} line ${index}, region ${region}`,
    exact: true,
  });
const hunk = (side: Side, region = 1) =>
  page.getByRole("button", {
    name: `Take ${side.toLowerCase()}, region ${region}`,
    exact: true,
  });
const button = (name: string) =>
  page.getByRole("button", { name, exact: true });
const result = () => page.getByRole("textbox", { name: "Result" });
const shown = (
  first: readonly string[] = ["", ""],
  second: readonly string[] = [""],
) => content(first, second);

async function opened() {
  const fixture = await mergeViewFixture();
  await expect.element(line("Current", 1)).toBeVisible();
  return fixture;
}

function focus(target: ReturnType<typeof line>) {
  (target.element() as HTMLElement).focus();
}

describe("merge view", () => {
  it("aligns both sides and counts the open regions", async () => {
    await opened();
    const rows = (side: string, kind = "") =>
      document.querySelectorAll(
        `[data-pane="${side}"] [data-row${kind === "" ? "" : `="${kind}"`}]`,
      );
    expect(rows("current").length).toBe(rows("incoming").length);
    expect(rows("current", "padding")).toHaveLength(0);
    expect(rows("incoming", "padding")).toHaveLength(1);
    await expect.element(page.getByText("2 of 2 open")).toBeVisible();
    await expect
      .element(page.getByText("Move retries into config"))
      .toBeVisible();
    await expect(result()).toHaveValue(shown());
  });

  it("follows click order across sides and removes a line on its second click", async () => {
    const f = await opened();
    await line("Current", 1).click();
    await line("Incoming", 1).click();
    await line("Current", 2).click();
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  retries: 5,", "  delay: 100,"]));
    await expect.element(page.getByText("1 of 2 open")).toBeVisible();

    await line("Incoming", 1).click();

    await expect
      .element(line("Incoming", 1))
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"]));
  });

  it("picks a dragged range in drag order", async () => {
    const f = await opened();
    await line("Current", 2).dropTo(line("Current", 1));
    await expect
      .poll(() => f.text())
      .toBe(content(["  delay: 100,", "  retries: 3,"]));
    await expect
      .element(line("Current", 1))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("takes and releases a whole side with its hunk button", async () => {
    const f = await opened();
    await line("Current", 1).click();
    await expect
      .element(hunk("Current"))
      .toHaveAttribute("aria-pressed", "false");
    await hunk("Incoming").click();
    await hunk("Current").click();
    await expect
      .element(hunk("Current"))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  retries: 5,", "  delay: 100,"]));

    await hunk("Current").click();

    await expect
      .element(hunk("Current"))
      .toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => f.text()).toBe(content(["  retries: 5,"]));
  });

  it("toggles and extends lines from the keyboard", async () => {
    const f = await opened();
    focus(line("Current", 1));
    await userEvent.keyboard(" ");
    await expect
      .element(line("Current", 1))
      .toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"]));
    await expect.element(line("Current", 2)).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => f.text()).toBe(content(["  retries: 3,"]));
  });

  it("moves between regions from the keyboard and closes with Escape", async () => {
    const f = await opened();
    focus(line("Current", 1));
    await userEvent.keyboard("{Alt>}1{/Alt}");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"]));
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await expect
      .element(hunk("Incoming", 2))
      .toHaveAttribute("aria-keyshortcuts", "Alt+2");
    await expect.element(button("Next region")).toBeDisabled();
    await userEvent.keyboard("{Alt>}2{/Alt}");
    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"], ["  return 2;"]));

    await userEvent.keyboard("{Escape}");

    expect(f.onClose).toHaveBeenCalledOnce();
  });

  it("swaps base into the left pane", async () => {
    const f = await opened();
    await button("Base").click();
    await line("Base", 1, 2).click();
    await expect
      .poll(() => f.text())
      .toBe(content(firstMarker, ["  return 0;"]));
    await expect.element(line("Current", 1)).not.toBeInTheDocument();
    await expect
      .element(hunk("Base", 2))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("keeps typed text until the next pick in that region", async () => {
    const f = await opened();
    await line("Current", 1).click();
    await expect.poll(() => f.text()).toBe(content(["  retries: 3,"]));
    const end = shown(["  retries: 3,"]).indexOf("  retries: 3,") + 13;
    const area = result().element() as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(end, end);
    await userEvent.keyboard(" // two");
    await expect.poll(() => f.text()).toBe(content(["  retries: 3, // two"]));

    await line("Current", 2).click();

    await expect
      .poll(() => f.text())
      .toBe(content(["  retries: 3,", "  delay: 100,"]));
  });

  it("coalesces changes made while a write is in flight", async () => {
    const f = await opened();
    f.holdWrites();
    await line("Current", 1).click();
    await expect.poll(() => f.writes.length).toBe(1);
    await line("Incoming", 1).click();
    await line("Current", 2).click();

    f.releaseWrites();

    const latest = content(["  retries: 3,", "  retries: 5,", "  delay: 100,"]);
    await expect.poll(() => f.text()).toBe(latest);
    expect(f.writes.map(({ revision }) => revision)).toEqual([
      "revision-0",
      "revision-1",
    ]);
    expect(f.writes[1]?.content).toBe(latest);
  });

  it("reloads the document on a stale write and keeps the file open", async () => {
    const f = await opened();
    f.staleOnNextWrite();
    await line("Current", 1).click();
    await expect
      .element(page.getByText("config.ts changed on disk. Reloaded."))
      .toBeVisible();
    await expect(result()).toHaveValue(shown(["// changed on disk"]));
    await expect.element(page.getByText("1 of 1 open")).toBeVisible();
    expect(f.onClose).not.toHaveBeenCalled();
  });

  it("restores the marker block when a region is undone", async () => {
    const f = await opened();
    await line("Incoming", 1).click();
    await expect.poll(() => f.text()).toBe(content(["  retries: 5,"]));

    await button("Undo region 1").click();

    await expect(result()).toHaveValue(shown());
    await expect.poll(() => f.text()).toBe(initialContent);
    await expect
      .element(line("Incoming", 1))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("confirms before staging a file with markers and moves to the next open file", async () => {
    const f = await mergeViewFixture({
      otherFiles: [
        { path: "src/done.ts", openRegions: 0 },
        { path: "src/next.ts", openRegions: 1 },
      ],
    });
    await button("Mark resolved").click();
    await expect.element(button("Cancel")).toHaveFocus();

    await button("Mark resolved anyway").click();

    await expect.poll(() => f.onOpen.mock.calls).toEqual([["src/next.ts"]]);
    expect(f.stages).toMatchObject([
      { path, allowMarkers: false },
      { path, allowMarkers: true, revision: "revision-0" },
    ]);
    expect(f.onClose).not.toHaveBeenCalled();
  });

  it("offers only whole-file choices when the document is too large", async () => {
    await mergeViewFixture({ documentFailure: "TooLarge" });
    await button("Whole file").click();
    await expect
      .element(page.getByRole("menuitem", { name: "Use current" }))
      .toBeVisible();
    await expect.element(result()).not.toBeInTheDocument();
    await expect.element(button("Mark resolved")).not.toBeInTheDocument();
  });
});
