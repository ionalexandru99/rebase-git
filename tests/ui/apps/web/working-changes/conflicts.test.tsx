import {
  type ChooseConflict,
  type ConflictDocument,
  type ConflictFile,
  type ConflictList,
  type MutateChanges,
  type RepositoryChanges,
  RepositoryChangesApi,
  RepositoryConflictsApi,
  type StageConflict,
} from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { WorkingChanges } from "#web/features/working-changes/working-changes";

const current = "c".repeat(40);
const incoming = "d".repeat(40);
const base = "b".repeat(40);
const conflicted = "src/app.ts";
const removed = "src/removed.ts";
const logo = "assets/logo.png";

function stage(side: "base" | "current" | "incoming", binary = false) {
  return { side, bytes: 1200, binary };
}

const files: readonly ConflictFile[] = [
  {
    path: conflicted,
    revision: "app-1",
    kind: "both-modified",
    stages: [stage("base"), stage("current"), stage("incoming")],
    openRegions: 1,
    choices: ["current", "incoming"],
  },
  {
    path: removed,
    revision: "removed-1",
    kind: "deleted-in-current",
    stages: [stage("base"), stage("incoming")],
    openRegions: 0,
    choices: ["incoming", "delete"],
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
];

const sides = {
  base: { ref: null, commit: base, subject: null },
  current: { ref: "main", commit: current, subject: "Rename the reader" },
  incoming: { ref: "topic", commit: incoming, subject: "Read the status" },
};

const marker = [
  `<<<<<<< ${current.slice(0, 8)}`,
  "export const reader = readCurrent;",
  "=======",
  "export const reader = readIncoming;",
  `>>>>>>> ${incoming.slice(0, 8)}`,
];

async function fixture() {
  const unresolved = new Set(files.map((file) => file.path));
  const stages: StageConflict[] = [];
  const choices: ChooseConflict[] = [];
  const mutations: MutateChanges[] = [];
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
    renamesLimited: false,
  });
  const list = (): ConflictList => ({
    sides,
    files: files.filter((file) => unresolved.has(file.path)),
  });
  const document = (path: string): ConflictDocument => {
    const file = files.find((candidate) => candidate.path === path);
    if (file === undefined) throw new Error(`No conflict for ${path}`);
    if (path !== conflicted) return { file, content: "", regions: [] };
    return {
      file,
      content: ["export const status = 1;", ...marker, ""].join("\n"),
      regions: [
        {
          id: "one",
          line: 2,
          current: ["export const reader = readCurrent;"],
          base: [],
          incoming: ["export const reader = readIncoming;"],
          marks: { current: [], incoming: [] },
          open: true,
        },
      ],
    };
  };
  const requests = fakeRequests(
    respond(RepositoryChangesApi.read, () => changes()),
    respond(RepositoryChangesApi.mutate, (command) => {
      mutations.push(command);
      return { changes: changes(), diff: null };
    }),
    respond(RepositoryConflictsApi.list, () => list()),
    respond(RepositoryConflictsApi.document, ({ path }) => document(path)),
    respond(RepositoryConflictsApi.stage, (command) => {
      stages.push(command);
      if (command.path === conflicted && !command.allowMarkers)
        throw rejected({
          _tag: "ConflictFailed",
          reason: "Markers",
          detail: "Conflict markers remain.",
        });
      unresolved.delete(command.path);
      return list();
    }),
    respond(RepositoryConflictsApi.choose, (command) => {
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
  return { stages, choices, mutations, mergeViews };
}

const row = (path: string) =>
  page.getByRole("button", { name: `Conflict ${path}`, exact: true });

describe("conflicts in the Diffs tab", () => {
  it("lists each conflicted file once and keeps them out of bulk staging", async () => {
    const f = await fixture();
    const section = page.getByRole("region", { name: "Conflicted files" });
    await expect.element(section).toHaveTextContent("Conflicts 3");
    await expect.element(section).toHaveTextContent("1 open");
    await expect.element(section).toHaveTextContent("deleted in main");
    await expect.element(section).toHaveTextContent("binary");
    for (const path of [conflicted, removed, logo]) {
      await expect.element(row(path)).toBeVisible();
      await expect
        .element(
          page.getByRole("button", { name: `Unstaged ${path}`, exact: true }),
        )
        .not.toBeInTheDocument();
    }
    await expect.element(page.getByText("No staged files")).toBeVisible();

    await page.getByRole("button", { name: "Stage all", exact: true }).click();

    await expect.poll(() => f.mutations.length).toBe(1);
    expect(f.mutations[0]).toMatchObject({
      action: "stage",
      selection: { _tag: "Files", paths: ["src/other.ts"] },
    });
  });

  it("shows the working file with its conflict block delimited", async () => {
    await fixture();
    await expect
      .element(row(conflicted))
      .toHaveAttribute("aria-pressed", "true");
    const file = page.getByRole("region", { name: "Working file" });
    await expect.element(file).toHaveTextContent("export const status = 1;");
    await expect
      .element(file.getByRole("group", { name: "Region 1" }))
      .toHaveTextContent(marker.join(" "));
  });

  it("confirms before marking a file with markers resolved", async () => {
    const f = await fixture();
    const resolve = page.getByRole("button", {
      name: `Mark ${conflicted} resolved`,
    });
    await resolve.click();
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    await expect.element(cancel).toHaveFocus();
    await cancel.click();
    await expect
      .element(page.getByRole("button", { name: "Mark resolved anyway" }))
      .not.toBeInTheDocument();

    await resolve.click();
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

  it("offers the versions and whole-file choices the file has and hands off to the merge view", async () => {
    const f = await fixture();
    await row(removed).click();
    const versions = page.getByRole("group", { name: "Conflict versions" });
    const version = (name: string) => versions.getByRole("button", { name });
    await expect
      .element(version(`Current ${current.slice(0, 8)}`))
      .toBeDisabled();
    await expect.element(page.getByText("No file")).toBeVisible();

    await version(`Incoming ${incoming.slice(0, 8)}`).click();
    await version("Merge view").click();
    expect(f.mergeViews).toEqual([removed, removed]);

    await page.getByRole("button", { name: "Whole file" }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Use current" }))
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
});
