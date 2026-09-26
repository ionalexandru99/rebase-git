import {
  type ChangeDiff,
  type ChooseConflict,
  type ConflictDocument,
  type ConflictFile,
  type ConflictList,
  type RepositoryChanges,
  RepositoryChangesHttpApi,
  RepositoryConflictsHttpApi,
  type StageConflict,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { fakeRequests, respond } from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { WorkingChanges } from "#web/features/working-changes/working-changes";

const current = "c".repeat(40);
const incoming = "d".repeat(40);
const base = "b".repeat(40);
const conflicted = "src/app.ts";
const removed = "src/removed.ts";
const logo = "assets/logo.png";
const settled = "src/settled.ts";

function stage(side: "base" | "current" | "incoming", binary = false) {
  return { side, oid: side[0]?.repeat(40) ?? base, bytes: 1200, binary };
}

const files: readonly ConflictFile[] = [
  {
    path: conflicted,
    revision: "app-1",
    kind: "both-modified",
    stages: [stage("base"), stage("current"), stage("incoming")],
    openRegions: 2,
    choices: ["current", "incoming", "worktree"],
  },
  {
    path: removed,
    revision: "removed-1",
    kind: "deleted-in-current",
    stages: [stage("base"), stage("incoming")],
    openRegions: 0,
    choices: ["incoming", "delete", "worktree"],
  },
  {
    path: logo,
    revision: "logo-1",
    kind: "both-modified",
    stages: [
      stage("base", true),
      stage("current", true),
      stage("incoming", true),
    ],
    openRegions: 0,
    choices: ["current", "incoming"],
  },
  {
    path: settled,
    revision: "settled-1",
    kind: "both-modified",
    stages: [stage("base"), stage("current"), stage("incoming")],
    openRegions: 0,
    choices: ["current", "incoming", "worktree"],
  },
];

const sides = {
  base: { ref: null, commit: base, subject: null },
  current: { ref: "main", commit: current, subject: "Rename the reader" },
  incoming: { ref: "topic", commit: incoming, subject: "Read the status" },
};

const content = [
  "export const status = 1;",
  `<<<<<<< ${current.slice(0, 8)}`,
  "export const reader = readCurrent;",
  "=======",
  "export const reader = readIncoming;",
  `>>>>>>> ${incoming.slice(0, 8)}`,
  "",
].join("\n");

async function fixture({
  mergeTool = null,
}: {
  mergeTool?: string | null;
} = {}) {
  const unresolved = new Set(files.map((file) => file.path));
  const stages: StageConflict[] = [];
  const choices: ChooseConflict[] = [];
  const mergeViews: string[] = [];
  const conflictRow = (path: string) => ({
    path,
    previousPath: null,
    status: "U" as const,
  });
  const changes = (): RepositoryChanges => ({
    revision: `changes-${unresolved.size}`,
    head: "a".repeat(40),
    message: "",
    unstaged: [
      ...[...unresolved].map(conflictRow),
      { path: "src/other.ts", previousPath: null, status: "M" },
    ],
    staged: [
      ...[...unresolved].map(conflictRow),
      ...files
        .filter((file) => !unresolved.has(file.path))
        .map((file) => ({
          path: file.path,
          previousPath: null,
          status: "M" as const,
        })),
    ],
    truncated: false,
    renamesLimited: false,
  });
  const list = (): ConflictList => ({
    operation: "merge",
    sides,
    files: files.filter((file) => unresolved.has(file.path)),
    resolved: files
      .filter((file) => !unresolved.has(file.path))
      .map((file) => file.path),
    mergeTool,
  });
  const document = (path: string): ConflictDocument => {
    const file = files.find((candidate) => candidate.path === path);
    if (file === undefined) throw new Error(`No conflict for ${path}`);
    return {
      file,
      sides,
      content: path === conflicted ? content : "",
      regions:
        path === conflicted
          ? [
              {
                id: "one",
                line: 2,
                current: ["export const reader = readCurrent;"],
                base: [],
                incoming: ["export const reader = readIncoming;"],
                blame: { current: null, incoming: null },
                marks: { current: [], incoming: [] },
                open: true,
              },
            ]
          : [],
    };
  };
  const diff: ChangeDiff = {
    path: "src/other.ts",
    revision: "other",
    kind: "text",
    before: "a\n",
    after: "b\n",
    beforeBytes: 2,
    afterBytes: 2,
    mime: null,
    patch: "",
  };
  const requests = fakeRequests(
    respond(RepositoryChangesHttpApi.read, () => changes()),
    respond(RepositoryChangesHttpApi.diff, () => diff),
    respond(RepositoryConflictsHttpApi.list, () => list()),
    respond(RepositoryConflictsHttpApi.document, ({ path }) => document(path)),
    respond(RepositoryConflictsHttpApi.stage, (command) => {
      stages.push(command);
      if (command.path === conflicted && !command.allowMarkers)
        throw new EnvironmentHttpRejected({
          failure: {
            _tag: "ConflictFailed",
            reason: "Markers",
            detail: "Conflict markers remain.",
          },
        });
      unresolved.delete(command.path);
      return list();
    }),
    respond(RepositoryConflictsHttpApi.choose, (command) => {
      choices.push(command);
      unresolved.delete(command.path);
      return list();
    }),
  );
  const repositoryId = crypto.randomUUID();
  await render(
    <div className="dark text-foreground" style={{ width: 1100, height: 700 }}>
      <WorkingChanges
        target={{
          repositoryId,
          worktreePath: "/repo",
          draftKey: JSON.stringify([crypto.randomUUID(), repositoryId]),
          active: true,
        }}
        writable
        openMergeView={(path) => mergeViews.push(path)}
      />
    </div>,
    { environment: { requests } },
  );
  await expect
    .element(page.getByRole("region", { name: "Conflicted files" }))
    .toBeVisible();
  return { stages, choices, mergeViews };
}

const row = (path: string) =>
  page.getByRole("button", { name: `Conflict ${path}`, exact: true });

describe("conflicts in the Diffs tab", () => {
  it("lists each conflicted file once with a plain label", async () => {
    await fixture();
    const section = page.getByRole("region", { name: "Conflicted files" });
    await expect.element(section).toHaveTextContent("Conflicts 4");
    await expect.element(section).toHaveTextContent("2 open");
    await expect.element(section).toHaveTextContent("deleted in main");
    await expect.element(section).toHaveTextContent("binary");
    await expect.element(section).toHaveTextContent("both changed");
    for (const path of [conflicted, removed, logo, settled]) {
      await expect.element(row(path)).toBeVisible();
      await expect
        .element(
          page.getByRole("button", { name: `Unstaged ${path}`, exact: true }),
        )
        .not.toBeInTheDocument();
      await expect
        .element(
          page.getByRole("button", { name: `Staged ${path}`, exact: true }),
        )
        .not.toBeInTheDocument();
    }
    await expect
      .element(
        page.getByRole("button", {
          name: "Unstaged src/other.ts",
          exact: true,
        }),
      )
      .toBeVisible();
    await expect.element(page.getByText("No staged files")).toBeVisible();
  });

  it("shows the working file with its conflict blocks delimited", async () => {
    await fixture();
    await expect
      .element(row(conflicted))
      .toHaveAttribute("aria-pressed", "true");
    const result = page.getByRole("region", { name: "Result" });
    await expect.element(result).toHaveTextContent("readCurrent");
    const parts = (kind: string) =>
      result.element().querySelectorAll(`[data-conflict-part="${kind}"]`);
    expect(parts("current")).toHaveLength(1);
    expect(parts("incoming")).toHaveLength(1);
    expect(parts("marker")).toHaveLength(3);
    expect(parts("current")[0]?.textContent).toBe(
      "export const reader = readCurrent;\n",
    );
  });

  it("confirms before marking a file with markers resolved", async () => {
    const f = await fixture();
    await page
      .getByRole("button", { name: `Mark ${conflicted} resolved` })
      .click();
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    await expect.element(cancel).toHaveFocus();
    await cancel.click();
    await expect
      .element(page.getByRole("button", { name: "Mark resolved anyway" }))
      .not.toBeInTheDocument();
    await page
      .getByRole("button", { name: `Mark ${conflicted} resolved` })
      .click();
    await page.getByRole("button", { name: "Mark resolved anyway" }).click();
    await expect.element(row(conflicted)).not.toBeInTheDocument();
    await expect
      .element(
        page.getByRole("button", { name: `Staged ${conflicted}`, exact: true }),
      )
      .toBeVisible();
    expect(f.stages.map((command) => command.allowMarkers)).toEqual([
      false,
      false,
      true,
    ]);
    expect(f.stages[2]).toMatchObject({ path: conflicted, revision: "app-1" });
  });

  it("offers only the whole-file choices and versions the file has", async () => {
    const f = await fixture();
    await row(removed).click();
    const versions = page.getByRole("group", { name: "Conflict versions" });
    await expect
      .element(
        versions.getByRole("button", {
          name: `Current ${current.slice(0, 8)}`,
        }),
      )
      .toBeDisabled();
    await expect
      .element(
        versions.getByRole("button", {
          name: `Incoming ${incoming.slice(0, 8)}`,
        }),
      )
      .toBeEnabled();
    await expect
      .element(
        versions.getByRole("button", { name: `Base ${base.slice(0, 8)}` }),
      )
      .toBeEnabled();
    await expect.element(page.getByText("No file")).toBeVisible();
    await versions
      .getByRole("button", { name: `Incoming ${incoming.slice(0, 8)}` })
      .click();
    await versions.getByRole("button", { name: "Merge view" }).click();
    expect(f.mergeViews).toEqual([removed, removed]);
    await page.getByRole("button", { name: "Whole file" }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Use current" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("menuitem", { name: "Use incoming" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: "Mark resolved" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: "Open in merge tool" }))
      .not.toBeInTheDocument();
    await page.getByRole("menuitem", { name: "Keep deletion" }).click();
    await expect.element(row(removed)).not.toBeInTheDocument();
    expect(f.choices).toEqual([
      expect.objectContaining({
        path: removed,
        revision: "removed-1",
        choice: "delete",
      }),
    ]);
  });

  it("offers the merge tool when one is configured", async () => {
    await fixture({ mergeTool: "meld" });
    await row(logo).click();
    await page.getByRole("button", { name: "Whole file" }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Open in merge tool" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: "Mark resolved" }))
      .not.toBeInTheDocument();
  });

  it("selects and resolves conflicts from the keyboard", async () => {
    const f = await fixture();
    row(settled).element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(row(settled)).toHaveAttribute("aria-pressed", "true");
    await userEvent.tab();
    await expect
      .element(page.getByRole("button", { name: `Mark ${settled} resolved` }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(row(settled)).not.toBeInTheDocument();
    expect(f.stages).toEqual([
      expect.objectContaining({ path: settled, allowMarkers: false }),
    ]);
  });
});
