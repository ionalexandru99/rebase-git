import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  RepositoryConflictsApi,
  type WriteConflict,
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

async function fixture() {
  const writes: WriteConflict[] = [];
  const input = { repositoryId, worktreePath: "/repo", path };
  const document = conflictDocument(path, content);
  const requests = fakeRequests(
    respond(RepositoryConflictsApi.document, () => document),
    respond(RepositoryConflictsApi.write, (command) => {
      writes.push(command);
      return conflictDocument(path, command.content, `saved-${writes.length}`);
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
  return { writes, file };
}

it("jumps between conflict blocks with the toolbar and the keyboard", async () => {
  const { file } = await fixture();
  const scrolled = () => file.element().scrollTop;

  await page.getByRole("button", { name: "Next conflict" }).click();
  await page.getByRole("button", { name: "Next conflict" }).click();
  await expect.poll(scrolled).toBeGreaterThan(0);
  const second = scrolled();
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");

  await expect.poll(scrolled).toBeLessThan(second);
});

it("undoes the last choice by saving the file as it was before", async () => {
  const { writes, file } = await fixture();
  await expect.element(page.getByText("12 of 12 open")).toBeVisible();

  await file
    .getByRole("button", { name: "Accept incoming change" })
    .first()
    .click();
  await expect.element(page.getByText("11 of 12 open")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();

  await expect.poll(() => writes.at(-1)?.content).toBe(content);
  await expect.element(page.getByText("12 of 12 open")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Undo" }))
    .toBeDisabled();
});
