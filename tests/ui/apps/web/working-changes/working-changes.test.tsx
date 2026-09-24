import type {
  ChangeDiff,
  CommitChanges,
  MutateChanges,
  RepositoryChanges,
} from "@rebase/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  type RepositoryChangesClient,
  WorkingChangesError,
} from "#web/features/working-changes/working-changes.contract";
import type { EnvironmentChangeListener } from "#web/platform/environment/environment-protocol.contract";
import { WorkingChanges } from "#web-ui/features/working-changes/working-changes";

const runtime = ManagedRuntime.make(Layer.empty);

const path = "src/read-status.ts";
const before = 'export const status = "old";\n';
const after = 'export const status = "new";\n';
const patch =
  'Index: "src/read-status.ts"\n===================================================================\n--- "src/read-status.ts"\t\n+++ "src/read-status.ts"\t\n@@ -1,1 +1,1 @@\n-export const status = "old";\n+export const status = "new";\n';

async function fixture(extraPaths: readonly string[] = []) {
  let snapshot: RepositoryChanges = {
    revision: "one",
    head: "a".repeat(40),
    message: "Old commit message",
    unstaged: [
      { path, status: "M" },
      ...extraPaths.map((path) => ({ path, status: "M" as const })),
    ],
    staged: [],
    truncated: false,
  };
  const diff: ChangeDiff = {
    path,
    revision: "diff-one",
    kind: "text",
    before,
    after,
    beforeBytes: before.length,
    afterBytes: after.length,
    mime: null,
    patch,
  };
  const mutations: MutateChanges[] = [];
  const commits: CommitChanges[] = [];
  let rejectCommit = false;
  let reads = 0;
  let diffReads = 0;
  const listeners = new Set<EnvironmentChangeListener>();
  const changes = {
    subscribe: (listener: EnvironmentChangeListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const client: RepositoryChangesClient = {
    read: () =>
      Effect.sync(() => {
        reads += 1;
        return snapshot;
      }),
    diff: () =>
      Effect.sync(() => {
        diffReads += 1;
        return diff;
      }),
    mutate: (command) =>
      Effect.sync(() => {
        mutations.push(command);
        snapshot = {
          ...snapshot,
          revision: `revision-${mutations.length}`,
          unstaged: command.action === "stage" ? [] : [{ path, status: "M" }],
          staged: command.action === "stage" ? [{ path, status: "M" }] : [],
        };
        return {
          changes: snapshot,
          diff:
            command.viewed !== undefined &&
            snapshot[command.viewed.section].length > 0
              ? diff
              : null,
        };
      }),
    commit: (command) =>
      Effect.suspend(() => {
        commits.push(command);
        if (rejectCommit)
          return Effect.fail(
            new WorkingChangesError({
              message: "Commit hook rejected this message.",
            }),
          );
        snapshot = { ...snapshot, revision: "committed", staged: [] };
        return Effect.succeed({ changes: snapshot, diff: null });
      }),
  };
  const environmentId = crypto.randomUUID(),
    repositoryId = crypto.randomUUID();
  const tree = () => (
    <div className="dark text-foreground" style={{ width: 1100, height: 700 }}>
      <WorkingChanges
        client={client}
        connected
        writable
        environmentId={environmentId}
        repositoryId={repositoryId}
        worktreePath="/repo"
        changes={changes}
        runtime={runtime}
      />
    </div>
  );
  const view = await render(tree());
  await expect
    .element(page.getByRole("button", { name: "Stage entire file" }))
    .toBeEnabled();
  return {
    view,
    tree,
    mutations,
    commits,
    reads: () => reads,
    diffReads: () => diffReads,
    emitChange: () => {
      for (const listener of listeners) listener([repositoryId], "Index");
    },
    advanceHead: (message: string) => {
      snapshot = {
        ...snapshot,
        head: crypto.randomUUID(),
        revision: crypto.randomUUID(),
        message,
      };
    },
    rejectCommit: (reject: boolean) => {
      rejectCommit = reject;
    },
  };
}

describe("working changes", () => {
  it("collapses folders and sections independently without changing Git state", async () => {
    const f = await fixture(["src/nested/change.ts"]);
    const folder = page.getByRole("button", {
      name: "Folder src/",
      exact: true,
    });
    const nested = page.getByRole("button", {
      name: "Folder src/nested/",
      exact: true,
    });
    await nested.click();
    await folder.click();
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    await expect.element(nested).not.toBeInTheDocument();
    await folder.click();
    await expect.element(nested).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(
        page.getByRole("button", { name: `Unstaged ${path}`, exact: true }),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Collapse unstaged" }).click();
    await expect.element(folder).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Expand unstaged" }).click();
    await expect.element(folder).toBeVisible();
    await expect.element(nested).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Collapse staged" }).click();
    await expect
      .element(page.getByText("No staged files"))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Expand staged" }).click();
    await expect.element(page.getByText("No staged files")).toBeVisible();
    expect(f.mutations).toEqual([]);
  });
  it.each(["Control", "Meta"] as const)(
    "selects multiple file rows with %s and stages the selection",
    async (modifier) => {
      const otherPath = "src/write-status.ts";
      const f = await fixture([otherPath]);
      await page
        .getByRole("button", { name: `Unstaged ${path}`, exact: true })
        .click();
      await page
        .getByRole("button", { name: `Unstaged ${otherPath}`, exact: true })
        .click({ modifiers: [modifier] });
      await expect
        .element(page.getByText("2 selected", { exact: true }))
        .toBeVisible();
      await page.getByRole("button", { name: "Stage", exact: true }).click();
      await expect.poll(() => f.mutations.length).toBe(1);
      expect(f.mutations[0]?.selection).toEqual({
        _tag: "Files",
        paths: [path, otherPath],
      });
    },
  );
  it("restores the normal draft and reloads the amend message when HEAD changes", async () => {
    const f = await fixture();
    const subject = page.getByRole("textbox", { name: "Commit subject" });
    const amend = page.getByRole("checkbox", { name: "Amend", exact: true });
    await subject.fill("New commit draft");
    await amend.click();
    await expect.element(subject).toHaveValue("Old commit message");
    await subject.fill("Edited amend draft");
    await amend.click();
    await expect.element(subject).toHaveValue("New commit draft");
    f.advanceHead("Another commit");
    await amend.click();
    await expect.element(subject).toHaveValue("Another commit");
    f.advanceHead("External commit");
    f.emitChange();
    await expect.element(amend).not.toBeChecked();
    await expect.element(subject).toHaveValue("New commit draft");
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("HEAD changed while you were amending");
  });
  it("re-reads changes when the server reports this repository changed or the window regains focus", async () => {
    const f = await fixture();
    const initialReads = f.reads();
    f.emitChange();
    await expect.poll(f.reads).toBe(initialReads + 1);
    window.dispatchEvent(new Event("focus"));
    await expect.poll(f.reads).toBe(initialReads + 2);
  });
  it("places the composer beneath the right tree and renders Shiki with working display controls", async () => {
    await fixture();
    const tree = page
      .getByRole("region", { name: "Changed files", exact: true })
      .element()
      .getBoundingClientRect();
    const editor = page
      .getByRole("region", { name: "Commit editor" })
      .element()
      .getBoundingClientRect();
    const diff = page
      .getByRole("region", { name: "File diff", exact: true })
      .element()
      .getBoundingClientRect();
    expect(tree.left).toBeGreaterThan(diff.left);
    expect(tree.width).toBeLessThan(diff.width);
    expect(
      page
        .getByRole("region", { name: "Staged files", exact: true })
        .element()
        .getBoundingClientRect().height,
    ).toBeLessThan(100);
    expect(editor.top).toBeGreaterThanOrEqual(tree.bottom);
    expect(editor.left).toBeCloseTo(tree.left, 0);
    await expect
      .poll(
        () =>
          document
            .querySelector("diffs-container")
            ?.shadowRoot?.querySelectorAll("[data-line]").length ?? 0,
      )
      .toBeGreaterThan(0);
    expect(
      document
        .querySelector("diffs-container")
        ?.shadowRoot?.querySelectorAll("[data-diffs-header]").length,
    ).toBe(1);
    expect(
      document
        .querySelector("diffs-container")
        ?.shadowRoot?.querySelector("[data-prev-name]"),
    ).toBeNull();
    await expect
      .poll(() => {
        const tokens = document
          .querySelector("diffs-container")
          ?.shadowRoot?.querySelectorAll("[data-line] span");
        return new Set(
          Array.from(tokens ?? [], (token) => getComputedStyle(token).color),
        ).size;
      })
      .toBeGreaterThan(1);
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Split", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => {
        const root = document.querySelector("diffs-container")?.shadowRoot;
        const pre = root?.querySelector('[data-diff-type="split"]');
        const lines = Array.from(root?.querySelectorAll("[data-line]") ?? []);
        return (
          pre !== null &&
          lines.some(
            (line) =>
              line.textContent?.includes('"old"') &&
              line.getBoundingClientRect().height > 0,
          ) &&
          lines.some(
            (line) =>
              line.textContent?.includes('"new"') &&
              line.getBoundingClientRect().height > 0,
          )
        );
      })
      .toBe(true);
    await page.getByRole("button", { name: "Word wrap" }).click();
  });
  it("stages a file and retains the unstaged file empty state", async () => {
    const f = await fixture();
    await page.getByRole("button", { name: "Stage entire file" }).click();
    await expect.poll(() => f.mutations.length).toBe(1);
    expect(f.mutations[0]?.selection).toMatchObject({
      _tag: "Files",
      paths: [path],
    });
    await expect
      .element(page.getByText("No unstaged changes in this file"))
      .toBeVisible();
    await expect
      .element(
        page.getByRole("button", { name: `Staged ${path}`, exact: true }),
      )
      .toBeVisible();
  });
  it("confirms discard and retains the commit draft on failure", async () => {
    const f = await fixture();
    await page
      .getByRole("button", { name: `Discard unstaged ${path}`, exact: true })
      .click();
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    expect(f.mutations).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Stage all", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Commit subject" })
      .fill("Keep the draft");
    f.rejectCommit(true);
    await page
      .getByRole("button", { name: "Commit 1 file", exact: true })
      .click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Commit hook rejected this message.");
    await expect
      .element(page.getByRole("textbox", { name: "Commit subject" }))
      .toHaveValue("Keep the draft");
    f.rejectCommit(false);
    await page
      .getByRole("button", { name: "Commit 1 file", exact: true })
      .click();
    await expect
      .element(page.getByRole("textbox", { name: "Commit subject" }))
      .toHaveValue("");
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Changes committed.");
    expect(f.commits).toHaveLength(2);
  });
  it("shows the viewed diff returned by a write without reading it again", async () => {
    const f = await fixture();
    const diffReads = f.diffReads();
    await page
      .getByRole("button", { name: `Discard unstaged ${path}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect.poll(() => f.mutations.length).toBe(1);
    await expect
      .element(page.getByRole("button", { name: "Stage entire file" }))
      .toBeEnabled();
    expect(f.mutations[0]?.viewed).toEqual({ section: "unstaged", path });
    expect(f.diffReads()).toBe(diffReads);
  });
});
