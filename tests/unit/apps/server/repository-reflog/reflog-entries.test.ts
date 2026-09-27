import { describe, expect, it } from "vite-plus/test";
import {
  groupReflog,
  type ReflogLine,
} from "#server/features/repository-reflog/reflog-entries.ts";

const oid = (character: string) => character.repeat(40);

function lines(
  ...entries: readonly (readonly [string, string])[]
): ReflogLine[] {
  return entries.map(([character, message], index) => ({
    oid: oid(character),
    message,
    recordedAt: 1_790_000_000 - index,
    subject: message,
  }));
}

describe("reflog grouping", () => {
  it("groups a paused rebase and drops an aborted one and no-op moves", () => {
    const entries = groupReflog(
      lines(
        ["c", "rebase (pick): Second"],
        ["d", "rebase (start): checkout main"],
        ["a", "rebase (abort): returning to refs/heads/topic"],
        ["e", "rebase (pick): First"],
        ["f", "rebase (start): checkout main"],
        ["a", "reset: moving to HEAD"],
        ["a", `reset: moving to ${oid("a")}`],
        ["b", "commit: Base"],
      ),
      new Set([oid("c")]),
    );

    expect(entries).toEqual([
      {
        oid: oid("c"),
        previousOid: oid("a"),
        action: "rebase",
        description: "Rebasing onto main",
        subject: "rebase (pick): Second",
        recordedAt: 1_790_000_000,
        orphaned: true,
        steps: [{ oid: oid("c"), label: "pick", description: "Second" }],
      },
      expect.objectContaining({
        action: "reset",
        description: "Moved to aaaaaaa",
        previousOid: oid("b"),
      }),
      expect.objectContaining({ action: "commit", previousOid: null }),
    ]);
  });

  it("shows a rebase stopped before its first pick as in progress", () => {
    expect(
      groupReflog(
        lines(["d", "rebase (start): checkout main"], ["a", "commit: Base"]),
        new Set(),
      )[0],
    ).toMatchObject({
      action: "rebase",
      description: "Rebasing onto main",
      previousOid: oid("a"),
    });
  });
});
