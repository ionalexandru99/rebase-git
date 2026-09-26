import { expect, it } from "vite-plus/test";
import {
  readCommitDraft,
  readDiffPreferences,
  saveCommitDraft,
  saveDiffPreferences,
} from "#web/persistence/working-changes/working-changes-store";

it("restores drafts per environment, repository, and worktree with client-wide display preferences", async () => {
  const key = JSON.stringify([crypto.randomUUID(), "repository", "/worktree"]);
  const other = JSON.stringify([
    crypto.randomUUID(),
    "repository",
    "/worktree",
  ]);
  await saveCommitDraft(key, {
    subject: "Keep this message",
    description: "Detailed draft",
  });
  await saveCommitDraft(other, {
    subject: "Other environment",
    description: "",
  });
  await saveDiffPreferences({
    split: true,
    wrap: true,
    tree: false,
  });
  expect(await readCommitDraft(key)).toEqual({
    subject: "Keep this message",
    description: "Detailed draft",
  });
  expect(await readCommitDraft(other)).toEqual({
    subject: "Other environment",
    description: "",
  });
  expect(await readCommitDraft(`${key}:other-worktree`)).toEqual({
    subject: "",
    description: "",
  });
  expect(await readDiffPreferences()).toEqual({
    split: true,
    wrap: true,
    tree: false,
  });
});
