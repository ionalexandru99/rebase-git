import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  type EditConflict,
  RepositoryConflictsApi,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { conflictDocument, repositoryId } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { ConflictMerge } from "#web/features/working-changes/conflicts/components/conflict-merge.tsx";

const path = "src/steps.ts";
const content = Array.from({ length: 12 }, (_, index) => [
  `export function step${index}() {`,
  "<<<<<<< HEAD",
  `  return ${index} * 2;`,
  "=======",
  `  return ${index} * 3;`,
  ">>>>>>> topic",
  "}",
  "",
])
  .flat()
  .join("\n");

function applyEdit(
  text: string,
  { line, count, text: inserted }: EditConflict,
) {
  const lines = text.split(/(?<=\n)/);
  lines.splice(line - 1, count, inserted);
  return lines.join("");
}

async function fixture(waitForSave: () => Promise<void> = async () => {}) {
  const edits: EditConflict[] = [];
  let saved = content;
  const input = { repositoryId, worktreePath: "/repo", path };
  const lines = content.split(/(?<=\n)/);
  const document = {
    ...conflictDocument(path, content),
    excerpts: [
      { line: 1, text: lines.slice(0, 48).join("") },
      { line: 49, text: lines.slice(48).join("") },
    ],
  };
  const requests = fakeRequests(
    respond(RepositoryConflictsApi.document, () => document),
    respond(RepositoryConflictsApi.edit, async (command) => {
      edits.push(command);
      await waitForSave();
      saved = applyEdit(saved, command);
      return conflictDocument(path, saved, `saved-${edits.length}`);
    }),
  );
  await render(
    <div className="dark text-foreground" style={{ width: 700, height: 500 }}>
      <ConflictMerge
        view={{ select: () => {} }}
        input={input}
        document={document}
        writable
      />
    </div>,
    { environment: { requests } },
  );
  const file = page.getByRole("region", { name: "Working file" });
  await expect
    .element(file.getByRole("button", { name: "Accept both" }).first())
    .toBeVisible();
  return { edits, file, saved: () => saved };
}

it("jumps between conflict blocks across excerpts with the toolbar and the keyboard", async () => {
  const { file } = await fixture();
  const scrolled = () => file.element().scrollTop;
  const secondExcerpt = () =>
    page.getByText("Line 49").element().getBoundingClientRect().top -
    file.element().getBoundingClientRect().top;

  for (let block = 0; block < 8; block++)
    await page.getByRole("button", { name: "Next conflict" }).click();
  await expect.poll(secondExcerpt).toBeLessThan(0);
  const eighth = scrolled();
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");

  await expect.poll(scrolled).toBeLessThan(eighth);
});

it("undoes the last choice by writing the conflict block back", async () => {
  const { edits, file, saved } = await fixture();
  await expect.element(page.getByText("12/12 open")).toBeVisible();

  await file
    .getByRole("button", { name: "Accept incoming change" })
    .first()
    .click();
  await expect.element(page.getByText("11/12 open")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();

  await expect.poll(() => edits.length).toBe(2);
  expect(edits.map(({ line, count }) => ({ line, count }))).toEqual([
    { line: 2, count: 5 },
    { line: 2, count: 1 },
  ]);
  expect(saved()).toBe(content);
  await expect.element(page.getByText("12/12 open")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Undo" }))
    .toBeDisabled();
});

it("keeps remaining choices on the saved revision while an edit is pending", async () => {
  let complete: () => void = () => {};
  const saving = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const { edits, file } = await fixture(() => saving);
  const incoming = file.getByRole("button", { name: "Accept incoming change" });

  await incoming.first().click();
  await expect.poll(() => edits.length).toBe(1);
  expect(incoming.all()).toHaveLength(12);

  complete();
  await expect.poll(() => incoming.all().length).toBe(11);
  await incoming.first().click();
  await expect.poll(() => edits.length).toBe(2);
  expect(edits[1]?.revision).toBe("saved-1");
});
