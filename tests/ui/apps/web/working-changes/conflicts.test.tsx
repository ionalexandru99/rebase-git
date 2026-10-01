import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  type MutateChanges,
  RepositoryChangesApi,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type ChooseConflict,
  type ConflictDocument,
  type ConflictFile,
  type ConflictList,
  type EditConflict,
  RepositoryConflictsApi,
  type StageConflict,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import { changedFile, repositoryChanges } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { WorkingChanges } from "#web/features/working-changes/working-changes.tsx";

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
  const edits: EditConflict[] = [];
  const markersLeft = () =>
    !edits.some(
      (edit) => edit.path === conflicted && !edit.text.includes("<<<"),
    );
  const conflictRow = (path: string) => changedFile(path, "U");
  const changes = () =>
    repositoryChanges({
      revision: `changes-${unresolved.size}`,
      unstaged: [
        ...[...unresolved].map(conflictRow),
        changedFile("src/other.ts"),
      ],
      staged: [
        ...[...unresolved].map(conflictRow),
        ...files
          .filter((file) => !unresolved.has(file.path))
          .map((file) => changedFile(file.path)),
      ],
    });
  const list = (): ConflictList => ({
    sides,
    files: files.filter((file) => unresolved.has(file.path)),
  });
  const document = (path: string): ConflictDocument => {
    const file = files.find((candidate) => candidate.path === path);
    if (file === undefined) throw new Error(`No conflict for ${path}`);
    if (path !== conflicted)
      throw rejected({
        _tag: "ConflictFailed",
        reason: "Unsupported",
        detail: "Resolve it as a whole file.",
      });
    return {
      file,
      excerpts: [
        {
          line: 1,
          text: ["export const status = 1;", ...marker, ""].join("\n"),
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
      if (command.path === conflicted && !command.allowMarkers && markersLeft())
        throw rejected({
          _tag: "ConflictFailed",
          reason: "Markers",
          detail: "Conflict markers remain.",
        });
      unresolved.delete(command.path);
      return list();
    }),
    respond(RepositoryConflictsApi.edit, (command) => {
      edits.push(command);
      const file = files.find(({ path }) => path === command.path);
      if (file === undefined)
        throw new Error(`No conflict for ${command.path}`);
      return {
        file: { ...file, revision: `${file.revision}-saved`, openRegions: 0 },
        excerpts: [],
      };
    }),
    respond(RepositoryConflictsApi.choose, (command) => {
      choices.push(command);
      if (command.path === logo)
        throw rejected({
          _tag: "ConflictFailed",
          reason: "Stale",
          detail: "The conflict changed on disk.",
        });
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
      />
    </div>,
    { environment: { requests } },
  );
  await expect
    .element(page.getByRole("region", { name: "Conflicted files" }))
    .toBeVisible();
  return { stages, choices, mutations, edits };
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
    await expect
      .element(page.getByRole("button", { name: "Collapse staged" }))
      .toHaveTextContent("Staged 0");

    await page.getByRole("button", { name: "Stage all", exact: true }).click();

    await expect.poll(() => f.mutations.length).toBe(1);
    expect(f.mutations[0]).toMatchObject({
      action: "stage",
      selection: { _tag: "Files", paths: ["src/other.ts"] },
    });
  });

  it("saves the block taken in the working file and marks it resolved with the saved revision", async () => {
    const f = await fixture();
    await expect
      .element(row(conflicted))
      .toHaveAttribute("aria-pressed", "true");
    const file = page.getByRole("region", { name: "Working file" });

    await file.getByRole("button", { name: "Accept incoming change" }).click();

    await expect
      .poll(() => f.edits.at(-1))
      .toMatchObject({
        path: conflicted,
        revision: "app-1",
        line: 2,
        count: 5,
        text: "export const reader = readIncoming;\n",
      });
    await page
      .getByRole("button", { name: "Mark resolved", exact: true })
      .click();
    await expect.element(row(removed)).toHaveAttribute("aria-pressed", "true");
    expect(f.stages).toEqual([
      expect.objectContaining({
        path: conflicted,
        revision: "app-1-saved",
        allowMarkers: false,
      }),
    ]);
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

  it("offers only the whole-file choices a file deleted on one side has", async () => {
    const f = await fixture();
    await row(removed).click();
    await expect.element(page.getByText("No file")).toBeVisible();

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

  it("shows a failed whole-file choice as a toast and keeps the conflict", async () => {
    await fixture();
    await row(logo).click();
    await page.getByRole("button", { name: "Whole file" }).click();
    await page.getByRole("menuitem", { name: "Use incoming" }).click();
    await expect
      .element(page.getByText("The conflict changed on disk."))
      .toBeVisible();
    await expect.element(row(logo)).toBeVisible();
  });
});
