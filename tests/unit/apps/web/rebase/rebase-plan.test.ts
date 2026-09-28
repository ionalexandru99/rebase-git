import { describe, expect, it } from "vite-plus/test";
import { historyCommit } from "#tests-support/history.ts";
import {
  messageOwner,
  messageSources,
  moveRow,
  type PlanRow,
  planProblem,
  planRows,
  planSteps,
  setAction,
} from "#web/features/rebase/rebase-plan.ts";

const oid = (name: string) => name.padEnd(40, "0");
const commit = (name: string, parents: readonly string[], subject = name) =>
  historyCommit(oid(name), parents.map(oid), 0, subject);
const shape = (rows: readonly PlanRow[]) =>
  rows.map((row) => `${row.action} ${row.subject}`);

describe("rebase plan", () => {
  it("lists commits newest first and places fixup! and squash! commits above their targets", () => {
    const rows = planRows([
      commit("b", ["a"], "fixup! Add engine"),
      commit("d", ["c"], "squash! Add engine"),
      commit("a", ["0"], "Add engine"),
      commit("c", ["b"], "Add tests"),
    ]);
    expect(shape(rows)).toEqual([
      "pick Add tests",
      "squash squash! Add engine",
      "fixup fixup! Add engine",
      "pick Add engine",
    ]);
  });

  it("keeps merges as fixed dropped rows that are never sent to the server", () => {
    const rows = planRows([
      commit("m", ["a", "s"], "Merge side"),
      commit("s", ["0"], "Side"),
      commit("a", ["0"], "Main"),
    ]);
    expect(rows[0]).toMatchObject({ action: "drop", merge: true });
    expect(setAction(rows, 0, "pick")).toBe(rows);
    expect(moveRow(rows, 0, 1)).toBe(rows);
    expect(planSteps(rows, {}).map((step) => step.commit)).not.toContain(
      oid("m"),
    );
  });

  it("folds squash and fixup into the next older kept commit and sends one message per group, oldest first", () => {
    let rows = planRows([
      commit("c", ["b"], "wip"),
      commit("b", ["a"], "typo"),
      commit("a", ["0"], "Add engine"),
    ]);
    rows = setAction(setAction(rows, 0, "squash"), 1, "fixup");
    expect(messageOwner(rows, 0)).toBe(2);
    expect(messageSources(rows, 2)).toEqual([oid("a"), oid("c")]);
    expect(planSteps(rows, { [oid("a")]: "Add engine\n\nWith rules" })).toEqual(
      [
        {
          commit: oid("a"),
          action: "pick",
          message: "Add engine\n\nWith rules",
        },
        { commit: oid("b"), action: "fixup", message: null },
        { commit: oid("c"), action: "squash", message: null },
      ],
    );
  });

  it("reports a fold with nothing older and an emptied message", () => {
    const rows = planRows([
      commit("b", ["a"], "Second"),
      commit("a", ["0"], "First"),
    ]);
    expect(planProblem(setAction(rows, 1, "fixup"), {})).toEqual({
      index: 1,
      text: "Nothing older to fixup into.",
    });
    expect(
      planProblem(setAction(rows, 0, "reword"), { [oid("b")]: "  " }),
    ).toEqual({ index: 0, text: "Message is empty." });
  });
});
