import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import {
  type ChangesFailure,
  type CommitChanges,
  changesFailed,
  type MutateChanges,
  type RepositoryChanges,
  RepositoryChangesApi,
  type UndoDiscard,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import {
  fakeRequests,
  rejected,
  respond,
  unanswered,
} from "#tests-support/fake-requests.ts";
import {
  changeDiff,
  changedFile,
  discardedChanges,
  repositoryChanges,
} from "#tests-support/fixtures.ts";
import { render, testChanges } from "#tests-support/render.tsx";
import { defaultDiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";
import { WorkingChanges } from "#web/features/working-changes/working-changes.tsx";
import { saveDiffPreferences } from "#web/persistence/working-changes/working-changes-store.ts";

const path = "src/read-status.ts";
const before = 'export const status = "old";\n';
const after = 'export const status = "new";\n';
const patch =
  'Index: "src/read-status.ts"\n===================================================================\n--- "src/read-status.ts"\t\n+++ "src/read-status.ts"\t\n@@ -1,1 +1,1 @@\n-export const status = "old";\n+export const status = "new";\n';

async function diffReady() {
  await expect
    .element(page.getByRole("button", { name: `Stage ${path}`, exact: true }))
    .toBeEnabled();
  await expect
    .element(page.getByRole("button", { name: "Next hunk" }))
    .toBeVisible();
}

async function fixture(
  extraPaths: readonly string[] = [],
  {
    staged = [],
    renamesLimited = false,
    diffs: initialDiffs = {},
    afterWrite,
    rejectDiffs = false,
    repositoryId = crypto.randomUUID(),
    draftKey = JSON.stringify([crypto.randomUUID(), repositoryId, "/repo"]),
    openGitIdentity = () => {},
  }: {
    readonly staged?: RepositoryChanges["staged"];
    readonly renamesLimited?: boolean;
    readonly diffs?: Readonly<Record<string, ChangeDiff>>;
    readonly afterWrite?: ChangeDiff;
    readonly rejectDiffs?: boolean;
    readonly repositoryId?: string;
    readonly draftKey?: string;
    readonly openGitIdentity?: () => void;
  } = {},
) {
  let snapshot = repositoryChanges({
    message: "Old commit message",
    unstaged: [path, ...extraPaths].map((path) => changedFile(path)),
    staged,
    renamesLimited,
  });
  const diff = changeDiff(path, {
    revision: "diff-one",
    kind: "text",
    before,
    after,
    beforeBytes: before.length,
    afterBytes: after.length,
    patch,
  });
  let diffs = initialDiffs;
  const mutations: MutateChanges[] = [];
  const commits: CommitChanges[] = [];
  const undos: UndoDiscard[] = [];
  let commitFailure: ChangesFailure | RepositoryRejected | undefined;
  let rejectAmendReads = false;
  let diffsRejected = rejectDiffs;
  let staleMutations = false;
  let writesHeld: Promise<void> | undefined;
  let reads = 0;
  let diffReads = 0;
  const requests = fakeRequests(
    respond(RepositoryChangesApi.read, (command) => {
      reads += 1;
      if (command.amend && rejectAmendReads)
        throw rejected(
          changesFailed("Conflict", "There is no commit to amend."),
        );
      return snapshot;
    }),
    respond(RepositoryChangesApi.diff, (command) => {
      diffReads += 1;
      if (diffsRejected) throw unanswered;
      return diffs[command.path] ?? diff;
    }),
    respond(RepositoryChangesApi.mutate, async (command) => {
      mutations.push(command);
      await writesHeld;
      if (staleMutations)
        throw rejected(changesFailed("Stale", "The changes moved on."));
      snapshot = {
        ...snapshot,
        revision: `revision-${mutations.length}`,
        unstaged: command.action === "stage" ? [] : [changedFile(path)],
        staged: command.action === "stage" ? [changedFile(path)] : [],
      };
      if (afterWrite) diffs = { ...diffs, [path]: afterWrite };
      return {
        changes: snapshot,
        diff:
          command.viewed !== undefined &&
          snapshot[command.viewed.section].length > 0
            ? (afterWrite ?? diff)
            : null,
        discarded:
          command.action === "discard"
            ? discardedChanges(String(mutations.length))
            : null,
      };
    }),
    respond(RepositoryChangesApi.undoDiscard, (command) => {
      undos.push(command);
      return { changes: snapshot, diff: null };
    }),
    respond(RepositoryChangesApi.commit, async (command) => {
      commits.push(command);
      if (command.amend)
        snapshot = { ...snapshot, head: crypto.randomUUID(), staged: [] };
      await writesHeld;
      if (commitFailure !== undefined) throw rejected(commitFailure);
      snapshot = { ...snapshot, revision: "committed", staged: [] };
      return { changes: snapshot, diff: null };
    }),
  );
  const { queryClient, publish } = testChanges();
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
    {
      environment: { requests },
      queryClient,
      notifications: { openGitIdentity },
    },
  );
  if (!rejectDiffs) await diffReady();
  return {
    view,
    queryClient,
    mutations,
    commits,
    undos,
    reads: () => reads,
    diffReads: () => diffReads,
    emitChange: () => {
      publish([repositoryId], "Index");
    },
    advanceHead: (message: string) => {
      snapshot = {
        ...snapshot,
        head: crypto.randomUUID(),
        revision: crypto.randomUUID(),
        message,
      };
    },
    rejectCommit: (failure?: ChangesFailure | RepositoryRejected) => {
      commitFailure = failure;
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

async function stageAll() {
  page.getByRole("button", { name: "Collapse unstaged" }).element().focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  await page.getByRole("menuitem", { name: "Stage all" }).click();
}

describe("working changes", () => {
  it("shows a staged rename on one row and its source in the diff", async () => {
    const renamed = "src/ui/Button.tsx";
    const source = "src/legacy/Button.tsx";
    await fixture([], {
      staged: [
        changedFile(renamed, "R", source),
        changedFile("src/ui/Card.tsx"),
      ],
      diffs: {
        [renamed]: changeDiff(renamed, {
          revision: "renamed",
          kind: "text",
          before,
          after: before,
          beforeBytes: before.length,
          afterBytes: before.length,
        }),
      },
    });
    const row = page.getByRole("button", {
      name: `Staged ${renamed} renamed from ${source}`,
      exact: true,
    });
    await expect.element(row).toHaveTextContent("Button.tsx← legacy/");
    await expect.element(row).toHaveAccessibleDescription("Renamed");
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
    await expect.element(page.getByText("Content unchanged.")).toBeVisible();
    await page.getByRole("radio", { name: "List view" }).click();
    await expect.element(row).toHaveTextContent("Button.tsx← legacy/ · src/ui");
    await page.getByRole("radio", { name: "Tree view" }).click();
  });
  it("says when too many files changed to match renames", async () => {
    await fixture([], { renamesLimited: true });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Renames not detected: too many changed files.");
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
    await page.getByRole("button", { name: "Expand staged" }).click();
    await expect
      .element(page.getByRole("button", { name: "Collapse staged" }))
      .toHaveAttribute("aria-expanded", "true");
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
    const amend = page.getByRole("checkbox", { name: "Amend last commit" });
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
      .element(page.getByText("HEAD changed while you were amending"))
      .toBeVisible();
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
    await page.getByRole("radio", { name: "Split" }).click();
    await expect
      .element(page.getByRole("radio", { name: "Split" }))
      .toBeChecked();
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
    await page
      .getByRole("button", { name: `Stage ${path}`, exact: true })
      .click();
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
  it("steps through hunks, discards the selected hunk and selects the next one after the write", async () => {
    const lines = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n";
    const twoHunks = lines.replace("b\n", "B\n").replace("k\n", "K\n");
    const oneHunk = lines.replace("b\n", "B\n");
    const firstHunk = "@@ -1,5 +1,5 @@\n a\n-b\n+B\n c\n d\n e\n";
    const header = `--- a/${path}\n+++ b/${path}\n`;
    const textDiff = (revision: string, after: string, patch: string) =>
      changeDiff(path, {
        revision,
        kind: "text",
        before: lines,
        after,
        beforeBytes: lines.length,
        afterBytes: after.length,
        patch: header + patch,
      });
    const f = await fixture([], {
      diffs: {
        [path]: textDiff(
          "two-hunks",
          twoHunks,
          `${firstHunk}@@ -8,5 +8,5 @@\n h\n i\n j\n-k\n+K\n l\n`,
        ),
      },
      afterWrite: textDiff("one-hunk", oneHunk, firstHunk),
    });
    const next = page.getByRole("button", { name: "Next hunk" });
    await expect.element(page.getByText("–/2", { exact: true })).toBeVisible();
    await next.click();
    await expect.element(page.getByText("1/2", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("2 lines selected", { exact: true }))
      .toBeVisible();
    await next.click();
    await expect.element(page.getByText("2/2", { exact: true })).toBeVisible();
    await expect.element(next).toBeDisabled();
    await page
      .getByRole("button", { name: "Discard hunk", exact: true })
      .click();
    await expect.poll(() => f.mutations.length).toBe(1);
    expect(f.mutations[0]).toMatchObject({
      action: "discard",
      section: "unstaged",
      selection: {
        _tag: "Lines",
        path,
        revision: "two-hunks",
        lines: ["-11", "+11"],
      },
    });
    await expect.element(page.getByText("1/1", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Stage hunk", exact: true }))
      .toBeEnabled();
  });
  it("discards without asking and undoes one discard per Ctrl+Z outside text fields", async () => {
    const f = await fixture();
    const discard = page.getByRole("button", {
      name: `Discard unstaged ${path}`,
      exact: true,
    });
    await discard.click();
    await expect.poll(() => f.mutations.length).toBe(1);
    await discard.click();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Discarded read-status.ts, Ctrl+Z to undo");

    await page.getByRole("textbox", { name: "Commit subject" }).click();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(page.getByRole("status").query()).not.toBeNull();
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard("{Control>}z{/Control}");
    await expect
      .poll(() => f.undos.map(({ discarded }) => discarded))
      .toEqual([discardedChanges("2")]);
    await expect.element(page.getByRole("status")).toBeVisible();
    await userEvent.keyboard("{Control>}z{/Control}");

    await expect
      .poll(() => f.undos.map(({ discarded }) => discarded))
      .toEqual([discardedChanges("2"), discardedChanges("1")]);
    await expect.element(page.getByRole("status")).not.toBeInTheDocument();
  });
  it("commits every change when nothing is staged", async () => {
    const f = await fixture(["src/other.ts"]);
    await page
      .getByRole("textbox", { name: "Commit subject" })
      .fill("Everything");
    await page
      .getByRole("button", { name: "Commit all 2 files", exact: true })
      .click();
    await expect
      .element(page.getByRole("textbox", { name: "Commit subject" }))
      .toHaveValue("");
    expect(f.commits).toHaveLength(1);
  });
  it("retains the commit draft on failure", async () => {
    const f = await fixture();
    await stageAll();
    await page
      .getByRole("textbox", { name: "Commit subject" })
      .fill("Keep the draft");
    f.rejectCommit(
      changesFailed("Conflict", "Commit hook rejected this message."),
    );
    await page
      .getByRole("button", { name: "Commit 1 file", exact: true })
      .click();
    await expect
      .element(page.getByText("Commit hook rejected this message."))
      .toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Commit subject" }))
      .toHaveValue("Keep the draft");
    f.rejectCommit();
    await page
      .getByRole("button", { name: "Commit 1 file", exact: true })
      .click();
    await expect
      .element(page.getByRole("textbox", { name: "Commit subject" }))
      .toHaveValue("");
    expect(f.commits).toHaveLength(2);
  });
  it("offers the identity settings when Git does not know who is committing", async () => {
    const openGitIdentity = vi.fn();
    const f = await fixture([], { openGitIdentity });
    await stageAll();
    await page
      .getByRole("textbox", { name: "Commit subject" })
      .fill("First commit");
    f.rejectCommit(
      repositoryRejected(
        "IdentityMissing",
        "Add your name and email to commit.",
      ),
    );

    await page
      .getByRole("button", { name: "Commit 1 file", exact: true })
      .click();
    await page.getByRole("button", { name: "Open settings" }).click();

    expect(openGitIdentity).toHaveBeenCalledOnce();
    await expect
      .element(page.getByText("Add your name and email to commit."))
      .not.toBeInTheDocument();
  });
  it("re-reads the changes when a write finds them stale", async () => {
    const f = await fixture();
    f.rejectMutationsAsStale();
    const reads = f.reads();
    await page
      .getByRole("button", { name: `Stage ${path}`, exact: true })
      .click();
    await expect.element(page.getByText("The changes moved on.")).toBeVisible();
    expect(f.reads()).toBeGreaterThan(reads);
    await diffReady();
  });
  it("shows the viewed diff returned by a write without reading it again", async () => {
    const f = await fixture();
    const diffReads = f.diffReads();
    await page
      .getByRole("button", { name: `Discard unstaged ${path}`, exact: true })
      .click();
    await expect.poll(() => f.mutations.length).toBe(1);
    await diffReady();
    expect(f.mutations[0]?.viewed).toEqual({ section: "unstaged", path });
    expect(f.diffReads()).toBe(diffReads);
  });
  it("drops the diffs written for earlier revisions of the viewed file", async () => {
    const f = await fixture();
    for (const write of [1, 2, 3, 4]) {
      await page
        .getByRole("button", { name: `Discard unstaged ${path}`, exact: true })
        .click();
      await expect.poll(() => f.mutations.length).toBe(write);
      await diffReady();
    }
    const cachedDiffs = f.queryClient.getQueryCache().findAll({
      predicate: ({ queryKey }) =>
        queryKey[3] === RepositoryChangesApi.diff._tag,
    });
    expect(cachedDiffs.length).toBeLessThanOrEqual(2);
  });
  it("reads the viewed diff again when Refresh follows a failed read", async () => {
    const f = await fixture([], { rejectDiffs: true });
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("The server did not answer.");
    const diffReads = f.diffReads();
    f.acceptDiffs();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await diffReady();
    await expect.poll(f.diffReads).toBeGreaterThan(diffReads);
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });
  it("amends without reporting its own HEAD move as an outside change", async () => {
    const f = await fixture([], {
      staged: [changedFile("src/other.ts")],
    });
    const subject = page.getByRole("textbox", { name: "Commit subject" });
    await page.getByRole("checkbox", { name: "Amend last commit" }).click();
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
      .element(page.getByRole("checkbox", { name: "Amend last commit" }))
      .not.toBeChecked();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });
  it("lets Amend be turned off after the amend read fails", async () => {
    const f = await fixture();
    f.rejectAmendReads();
    const amend = page.getByRole("checkbox", { name: "Amend last commit" });
    await amend.click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("There is no commit to amend.");
    await expect.element(amend).toBeEnabled();
    await amend.click();
    await expect.element(amend).not.toBeChecked();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await diffReady();
  });
  it("locks every write while one is running", async () => {
    const f = await fixture([], {
      staged: [changedFile("src/other.ts")],
    });
    await page
      .getByRole("textbox", { name: "Commit subject" })
      .fill("Ready to commit");
    const release = f.holdWrites();
    const stage = page.getByRole("button", {
      name: `Stage ${path}`,
      exact: true,
    });
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
    const transaction = vi
      .spyOn(IDBDatabase.prototype, "transaction")
      .mockImplementation(() => {
        throw new DOMException("Storage is blocked.", "InvalidStateError");
      });
    try {
      await fixture();
      await expect
        .element(page.getByRole("alert"))
        .toHaveTextContent(
          "Could not access changes preferences or the commit draft in this browser.",
        );
    } finally {
      transaction.mockRestore();
    }
  });
});
