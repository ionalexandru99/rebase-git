import {
  type ChangeDiff,
  type CommitChanges,
  changesFailed,
  type MutateChanges,
  type RepositoryChanges,
  RepositoryChangesHttpApi,
} from "@rebase/contracts";
import {
  EnvironmentHttpRejected,
  EnvironmentResponseError,
} from "@rebase/environment-client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { fakeRequests, respond } from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { defaultDiffPreferences } from "#web/domain/file-diff/diff-preferences.contract";
import { saveDiffPreferences } from "#web/persistence/working-changes/working-changes-store";
import type { EnvironmentChangeListener } from "#web/platform/environment/environment-protocol.contract";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query-client";
import { WorkingChanges } from "#web-ui/features/working-changes/working-changes";

const path = "src/read-status.ts";
const before = 'export const status = "old";\n';
const after = 'export const status = "new";\n';
const patch =
  'Index: "src/read-status.ts"\n===================================================================\n--- "src/read-status.ts"\t\n+++ "src/read-status.ts"\t\n@@ -1,1 +1,1 @@\n-export const status = "old";\n+export const status = "new";\n';

async function fixture(
  extraPaths: readonly string[] = [],
  {
    staged = [],
    renamesLimited = false,
    diffs = {},
    rejectDiffs = false,
    repositoryId = crypto.randomUUID(),
    draftKey = JSON.stringify([crypto.randomUUID(), repositoryId, "/repo"]),
  }: {
    readonly staged?: RepositoryChanges["staged"];
    readonly renamesLimited?: boolean;
    readonly diffs?: Readonly<Record<string, ChangeDiff>>;
    readonly rejectDiffs?: boolean;
    readonly repositoryId?: string;
    readonly draftKey?: string;
  } = {},
) {
  let snapshot: RepositoryChanges = {
    revision: "one",
    head: "a".repeat(40),
    message: "Old commit message",
    unstaged: [
      { path, previousPath: null, status: "M" },
      ...extraPaths.map((path) => ({
        path,
        previousPath: null,
        status: "M" as const,
      })),
    ],
    staged,
    truncated: false,
    renamesLimited,
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
  let rejectAmendReads = false;
  let diffsRejected = rejectDiffs;
  let staleMutations = false;
  let writesHeld: Promise<void> | undefined;
  let reads = 0;
  let diffReads = 0;
  const listeners = new Set<EnvironmentChangeListener>();
  const changes = {
    subscribe: (listener: EnvironmentChangeListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const requests = fakeRequests(
    respond(RepositoryChangesHttpApi.read, (command) => {
      reads += 1;
      if (command.amend && rejectAmendReads)
        throw new EnvironmentHttpRejected({
          failure: changesFailed("Conflict", "There is no commit to amend."),
        });
      return snapshot;
    }),
    respond(RepositoryChangesHttpApi.diff, (command) => {
      diffReads += 1;
      if (diffsRejected)
        throw new EnvironmentResponseError({
          responseTag: RepositoryChangesHttpApi.diff.path,
        });
      return diffs[command.path] ?? diff;
    }),
    respond(RepositoryChangesHttpApi.mutate, async (command) => {
      mutations.push(command);
      await writesHeld;
      if (staleMutations)
        throw new EnvironmentHttpRejected({
          failure: changesFailed("Stale", "The changes moved on."),
        });
      snapshot = {
        ...snapshot,
        revision: `revision-${mutations.length}`,
        unstaged:
          command.action === "stage"
            ? []
            : [{ path, previousPath: null, status: "M" }],
        staged:
          command.action === "stage"
            ? [{ path, previousPath: null, status: "M" }]
            : [],
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
    respond(RepositoryChangesHttpApi.commit, async (command) => {
      commits.push(command);
      if (command.amend)
        snapshot = { ...snapshot, head: crypto.randomUUID(), staged: [] };
      await writesHeld;
      if (rejectCommit)
        throw new EnvironmentHttpRejected({
          failure: changesFailed(
            "Conflict",
            "Commit hook rejected this message.",
          ),
        });
      snapshot = { ...snapshot, revision: "committed", staged: [] };
      return { changes: snapshot, diff: null };
    }),
  );
  const queryClient = createEnvironmentQueryClient();
  const view = await render(
    <div className="dark text-foreground" style={{ width: 1100, height: 700 }}>
      <WorkingChanges
        target={{
          repositoryId,
          worktreePath: "/repo",
          draftKey,
          active: true,
        }}
        writable
      />
    </div>,
    { environment: { requests, changes }, queryClient },
  );
  if (!rejectDiffs)
    await expect
      .element(page.getByRole("button", { name: "Stage entire file" }))
      .toBeEnabled();
  return {
    view,
    queryClient,
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
    rejectMutationsAsStale: () => {
      staleMutations = true;
    },
    rejectAmendReads: () => {
      rejectAmendReads = true;
    },
    acceptDiffs: () => {
      diffsRejected = false;
    },
    holdWrites: () => {
      const held = Promise.withResolvers<void>();
      writesHeld = held.promise;
      return () => {
        writesHeld = undefined;
        held.resolve();
      };
    },
    repositoryId,
    draftKey,
  };
}

afterEach(() => saveDiffPreferences(defaultDiffPreferences));

describe("working changes", () => {
  it("shows a staged rename on one row and its source in the diff", async () => {
    const renamed = "src/ui/Button.tsx";
    const source = "src/legacy/Button.tsx";
    await fixture([], {
      staged: [
        { path: renamed, previousPath: source, status: "R" },
        { path: "src/ui/Card.tsx", previousPath: null, status: "M" },
      ],
      diffs: {
        [renamed]: {
          path: renamed,
          revision: "renamed",
          kind: "text",
          before,
          after: before,
          beforeBytes: before.length,
          afterBytes: before.length,
          mime: null,
          patch: "",
        },
      },
    });
    const row = page.getByRole("button", {
      name: `Staged ${renamed} renamed from ${source}`,
      exact: true,
    });
    await expect.element(row).toHaveTextContent("Button.tsx← legacy/");
    const next = page.getByRole("button", {
      name: "Staged src/ui/Card.tsx",
      exact: true,
    });
    expect(
      next.element().getBoundingClientRect().top -
        row.element().getBoundingClientRect().top,
    ).toBe(32);
    await row.click();
    await expect
      .element(page.getByText(`${source} → ${renamed}`))
      .toBeVisible();
    await expect
      .element(page.getByText("File renamed. Content unchanged."))
      .toBeVisible();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect.element(row).toHaveTextContent("src/{legacy → ui}/Button.tsx");
    await page.getByRole("button", { name: "Tree", exact: true }).click();
  });
  it("says when too many files changed to match renames", async () => {
    await fixture([], { renamesLimited: true });
    await expect
      .element(page.getByRole("status").filter({ hasText: "match renames" }))
      .toHaveTextContent(
        "Too many changed files to match renames. Moved files show as deleted and added.",
      );
  });
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
    const beforeChange = f.reads();
    f.emitChange();
    await expect.poll(f.reads).toBeGreaterThan(beforeChange);
    const beforeFocus = f.reads();
    window.dispatchEvent(new Event("focus"));
    await expect.poll(f.reads).toBeGreaterThan(beforeFocus);
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
  it("re-reads the changes when a write finds them stale", async () => {
    const f = await fixture();
    f.rejectMutationsAsStale();
    const reads = f.reads();
    await page.getByRole("button", { name: "Stage entire file" }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("The changes moved on.");
    expect(f.reads()).toBeGreaterThan(reads);
    await expect
      .element(page.getByRole("button", { name: "Stage entire file" }))
      .toBeEnabled();
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
  it("reads the viewed diff again when Refresh follows a failed read", async () => {
    const f = await fixture([], { rejectDiffs: true });
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not complete the request.");
    const diffReads = f.diffReads();
    f.acceptDiffs();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Stage entire file" }))
      .toBeEnabled();
    expect(f.diffReads()).toBeGreaterThan(diffReads);
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });
  it("amends without reporting its own HEAD move as an outside change", async () => {
    const f = await fixture([], {
      staged: [{ path: "src/other.ts", previousPath: null, status: "M" }],
    });
    const subject = page.getByRole("textbox", { name: "Commit subject" });
    await page.getByRole("checkbox", { name: "Amend", exact: true }).click();
    await expect.element(subject).toHaveValue("Old commit message");
    const release = f.holdWrites();
    await page
      .getByRole("button", { name: "Amend commit", exact: true })
      .click();
    await expect.poll(() => f.commits.length).toBe(1);
    const reads = f.reads();
    f.emitChange();
    await expect.poll(f.reads).toBeGreaterThan(reads);
    await expect.poll(() => f.queryClient.isFetching()).toBe(0);
    release();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Commit amended.");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });
  it("lets Amend be turned off after the amend read fails", async () => {
    const f = await fixture();
    f.rejectAmendReads();
    const amend = page.getByRole("checkbox", { name: "Amend", exact: true });
    await amend.click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("There is no commit to amend.");
    await expect.element(amend).toBeEnabled();
    await amend.click();
    await expect.element(amend).not.toBeChecked();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Stage entire file" }))
      .toBeEnabled();
  });
  it("locks every write while one is running", async () => {
    const f = await fixture([], {
      staged: [{ path: "src/other.ts", previousPath: null, status: "M" }],
    });
    await page
      .getByRole("textbox", { name: "Commit subject" })
      .fill("Ready to commit");
    const release = f.holdWrites();
    const stage = page.getByRole("button", { name: "Stage entire file" });
    await stage.click();
    await expect.element(stage).toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Working…", exact: true }))
      .toBeDisabled();
    release();
    await expect
      .element(page.getByRole("button", { name: "Commit 1 file", exact: true }))
      .toBeEnabled();
  });
  it("restores a draft typed just before the panel closed", async () => {
    const f = await fixture();
    await page
      .getByRole("textbox", { name: "Commit subject" })
      .fill("Unsent message");
    await f.view.unmount();
    await fixture([], { repositoryId: f.repositoryId, draftKey: f.draftKey });
    await expect
      .element(page.getByRole("textbox", { name: "Commit subject" }))
      .toHaveValue("Unsent message");
  });
  it("says when this browser cannot keep the commit draft", async () => {
    const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new Error("Storage is blocked.");
    });
    try {
      await fixture();
      await expect
        .element(page.getByRole("alert"))
        .toHaveTextContent(
          "Could not access changes preferences or the commit draft in this browser.",
        );
    } finally {
      open.mockRestore();
    }
  });
});
