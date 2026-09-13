import { Effect } from "effect";
import { expect, it } from "vitest";
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
  await Effect.runPromise(
    saveCommitDraft(key, {
      subject: "Keep this message",
      description: "Detailed draft",
    }),
  );
  await Effect.runPromise(
    saveCommitDraft(other, { subject: "Other environment", description: "" }),
  );
  await Effect.runPromise(
    saveDiffPreferences({
      split: true,
      wrap: true,
      tree: false,
    }),
  );
  expect(await Effect.runPromise(readCommitDraft(key))).toEqual({
    subject: "Keep this message",
    description: "Detailed draft",
  });
  expect(await Effect.runPromise(readCommitDraft(other))).toEqual({
    subject: "Other environment",
    description: "",
  });
  expect(
    await Effect.runPromise(readCommitDraft(`${key}:other-worktree`)),
  ).toEqual({ subject: "", description: "" });
  expect(await Effect.runPromise(readDiffPreferences())).toEqual({
    split: true,
    wrap: true,
    tree: false,
  });
});
