import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import type {
  PlanAction,
  PlanStep,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { maximumPlanCommits } from "#web/features/rebase/rebase-plan.ts";
import type { HistoryScopeQuery } from "#web/features/repository-history/history-view.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

export type Rewrite = Extract<PlanAction, "drop" | "squash">;

export type RewritePlan =
  | {
      readonly _tag: "Blocked";
      readonly selected: readonly RepositoryCommit[];
      readonly reason: string;
    }
  | {
      readonly _tag: "Ready";
      readonly selected: readonly RepositoryCommit[];
      readonly head: string;
      readonly onto: string;
      readonly steps: readonly PlanStep[];
      readonly pushed: boolean;
    };

export type ReadyPlan = Extract<RewritePlan, { readonly _tag: "Ready" }>;

export async function rewritePlan(
  history: Pick<RepositoryHistory, "ask">,
  scope: HistoryScopeQuery,
  head: string,
  rewrite: Rewrite,
  oids: readonly string[],
  unpushed: number,
): Promise<RewritePlan | undefined> {
  const [rows, found] = await Promise.all([
    history.ask({ _tag: "Locate", scope, oids }),
    history.ask({ _tag: "Commits", oids }),
  ]);
  const row = new Map(oids.map((oid, index) => [oid, rows[index]]));
  if (
    found.length !== oids.length ||
    found.some((commit) => row.get(commit.oid) === undefined)
  )
    return undefined;
  const selected = [...found].sort(
    (left, right) => (row.get(left.oid) ?? 0) - (row.get(right.oid) ?? 0),
  );
  const oldest = selected.at(-1);
  if (oldest === undefined) return undefined;
  const parent = oldest.parents[0];
  const base =
    rewrite === "squash" && selected.length === 1 && parent !== undefined
      ? (await history.ask({ _tag: "Commits", oids: [parent] }))[0]
      : oldest;
  if (base === undefined) return undefined;
  const onto = base.parents[0];
  const range = await history.ask({
    _tag: "Range",
    head,
    onto: onto ?? base.oid,
  });
  if (range === undefined || !range.based) return undefined;
  const moving = new Set(onto === undefined ? [base.oid] : []);
  for (const oid of range.moving) moving.add(oid);
  if (
    range.count <= range.moving.length &&
    selected.some(({ oid }) => !moving.has(oid))
  )
    return undefined;
  if (onto === undefined)
    return { _tag: "Blocked", selected, reason: "Root commit" };
  if ([base, ...selected].some(({ parents }) => parents.length > 1))
    return { _tag: "Blocked", selected, reason: "Merge commit" };
  if (range.count > maximumPlanCommits)
    return {
      _tag: "Blocked",
      selected,
      reason: `${maximumPlanCommits.toLocaleString("en-US")} commits at most`,
    };
  const commits = new Map(
    (await history.ask({ _tag: "Commits", oids: range.moving })).map(
      (commit) => [commit.oid, commit],
    ),
  );
  if ([...commits.values()].some(({ parents }) => parents.length > 1))
    return { _tag: "Blocked", selected, reason: "Merges in range" };
  const chain: RepositoryCommit[] = [];
  for (let oid = head; oid !== onto; ) {
    const commit = commits.get(oid);
    const parent = commit?.parents[0];
    if (commit === undefined || parent === undefined) return undefined;
    chain.push(commit);
    oid = parent;
  }
  const rewritten = new Set(oids);
  if (rewrite === "squash") rewritten.delete(base.oid);
  const steps = chain.toReversed().map(
    ({ oid }): PlanStep => ({
      commit: oid,
      action: rewritten.has(oid) ? rewrite : "pick",
      message: null,
    }),
  );
  if (
    rewrite === "squash" &&
    steps.slice(1, rewritten.size + 1).some(({ action }) => action === "pick")
  )
    return { _tag: "Blocked", selected, reason: "Not consecutive" };
  return {
    _tag: "Ready",
    selected,
    head,
    onto,
    pushed: chain.findLastIndex(({ oid }) => rewritten.has(oid)) >= unpushed,
    steps,
  };
}
