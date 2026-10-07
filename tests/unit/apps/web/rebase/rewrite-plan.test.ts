import { describe, expect, it } from "vite-plus/test";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import {
  fakeRepositoryHistory,
  historyCommit,
  historyScope,
} from "#tests-support/history.ts";
import { rewritePlan } from "#web/features/rebase/rewrite-plan.ts";

const oid = (name: string) => name.padEnd(40, "0");
const commit = (name: string, parents: readonly string[], order: number) =>
  historyCommit(oid(name), parents.map(oid), order);

function plan(
  commits: readonly RepositoryCommit[],
  dropped: readonly string[],
  unpushed = Infinity,
  rewrite: "drop" | "squash" = "drop",
) {
  return rewritePlan(
    fakeRepositoryHistory({ commits }),
    historyScope(commits.map((commit) => commit.oid)),
    oid("e"),
    rewrite,
    dropped.map(oid),
    unpushed,
  );
}

const squash = (
  commits: readonly RepositoryCommit[],
  ...selected: readonly string[]
) => plan(commits, selected, Infinity, "squash");

const linear = [
  commit("e", ["d"], 5),
  commit("d", ["c"], 4),
  commit("c", ["b"], 3),
  commit("b", ["a"], 2),
  commit("a", [], 1),
];

describe("rewrite plan", () => {
  it("rebases onto the parent of the oldest selected commit and drops only the selection, in replay order", async () => {
    expect(await plan(linear, ["b", "d"])).toMatchObject({
      _tag: "Ready",
      onto: oid("a"),
      selected: [{ oid: oid("d") }, { oid: oid("b") }],
      pushed: false,
      steps: [
        { commit: oid("b"), action: "drop", message: null },
        { commit: oid("c"), action: "pick", message: null },
        { commit: oid("d"), action: "drop", message: null },
        { commit: oid("e"), action: "pick", message: null },
      ],
    });
  });

  it("says a force-push is needed when a dropped commit is on the upstream", async () => {
    expect(await plan(linear, ["d"], 2)).toMatchObject({ pushed: false });
    expect(await plan(linear, ["c"], 2)).toMatchObject({ pushed: true });
  });

  it("hides the drop for commits that are not on the current branch", async () => {
    const side = [
      commit("e", ["d"], 5),
      commit("d", ["a"], 4),
      commit("s", ["a"], 3),
      commit("a", [], 1),
    ];
    expect(await plan(side, ["d", "s"])).toBeUndefined();
    expect(await plan(side, ["a", "s"])).toBeUndefined();
  });

  it("hides commits off the branch before blocking a range over 1,000 commits", async () => {
    const long = [
      commit("e", ["c0."], 2_000),
      ...Array.from({ length: 1_001 }, (_, index) =>
        commit(
          `c${index}.`,
          [index === 1_000 ? "a" : `c${index + 1}.`],
          1_999 - index,
        ),
      ),
      commit("s", ["a"], 1),
      commit("a", [], 0),
    ];
    expect(await plan(long, ["s"])).toBeUndefined();
    expect(await plan(long, ["c1000."])).toMatchObject({
      _tag: "Blocked",
      reason: "1,000 commits at most",
    });
  });

  it("blocks merges in the selection or between it and HEAD, and the root commit", async () => {
    const merged = [
      commit("e", ["m"], 6),
      commit("m", ["c", "s"], 5),
      commit("s", ["b"], 4),
      commit("c", ["b"], 3),
      commit("b", ["a"], 2),
      commit("a", [], 1),
    ];
    expect(await plan(merged, ["m"])).toMatchObject({
      _tag: "Blocked",
      reason: "Merge commit",
    });
    expect(await plan(merged, ["c"])).toMatchObject({
      _tag: "Blocked",
      reason: "Merges in range",
    });
    expect(await plan(linear, ["a"])).toMatchObject({
      _tag: "Blocked",
      reason: "Root commit",
    });
  });

  it("squashes into the parent by rebasing onto the grandparent", async () => {
    expect(await squash(linear, "d")).toMatchObject({
      _tag: "Ready",
      onto: oid("b"),
      steps: [
        { commit: oid("c"), action: "pick", message: null },
        { commit: oid("d"), action: "squash", message: null },
        { commit: oid("e"), action: "pick", message: null },
      ],
    });
  });

  it("squashes several consecutive commits into the oldest of them", async () => {
    expect(await squash(linear, "d", "c", "b")).toMatchObject({
      _tag: "Ready",
      onto: oid("a"),
      steps: [
        { commit: oid("b"), action: "pick", message: null },
        { commit: oid("c"), action: "squash", message: null },
        { commit: oid("d"), action: "squash", message: null },
        { commit: oid("e"), action: "pick", message: null },
      ],
    });
    expect(await squash(linear, "b", "d")).toMatchObject({
      _tag: "Blocked",
      reason: "Not consecutive",
    });
  });

  it("blocks a squash into the root commit or a merge", async () => {
    expect(await squash(linear, "b")).toMatchObject({
      _tag: "Blocked",
      reason: "Root commit",
    });
    const merged = [
      commit("e", ["m"], 5),
      commit("m", ["c", "s"], 4),
      commit("s", ["a"], 3),
      commit("c", ["a"], 2),
      commit("a", [], 1),
    ];
    expect(await squash(merged, "e")).toMatchObject({
      _tag: "Blocked",
      reason: "Merge commit",
    });
  });
});
