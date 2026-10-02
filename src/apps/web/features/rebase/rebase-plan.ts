import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import type {
  PlanAction,
  PlanStep,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

export interface RebasePlanTarget {
  readonly ref: string | null;
  readonly commit: string;
  readonly from: boolean;
}

export interface PlanRow {
  readonly commit: string;
  readonly subject: string;
  readonly action: PlanAction;
  readonly merge: boolean;
}

export type PlanMessages = Readonly<Record<string, string | undefined>>;

export type PlanHistory = Pick<RepositoryHistory, "ask"> | undefined;

export type LoadedPlan =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Unavailable"; readonly text: string }
  | {
      readonly _tag: "Ready";
      readonly onto: string;
      readonly rows: readonly PlanRow[];
    };

export const maximumPlanCommits = 1_000;

export function isRebasePlanTarget(input: unknown): input is RebasePlanTarget {
  return (
    typeof input === "object" &&
    input !== null &&
    "commit" in input &&
    typeof input.commit === "string" &&
    "from" in input &&
    typeof input.from === "boolean" &&
    "ref" in input &&
    (input.ref === null || typeof input.ref === "string")
  );
}

export async function loadPlan(
  history: PlanHistory,
  head: string,
  target: RebasePlanTarget,
): Promise<LoadedPlan> {
  if (history === undefined) return { _tag: "Loading" };
  const onto = target.from
    ? (await history.ask({ _tag: "Commits", oids: [target.commit] }))[0]
        ?.parents[0]
    : target.commit;
  if (onto === undefined)
    return {
      _tag: "Unavailable",
      text: "The first commit of the history can't be rebased.",
    };
  const range = await history.ask({ _tag: "Range", head, onto });
  if (range === undefined)
    return { _tag: "Unavailable", text: "These commits aren't loaded yet." };
  if (range.count > range.moving.length || range.count > maximumPlanCommits)
    return {
      _tag: "Unavailable",
      text: `Plans hold up to ${maximumPlanCommits} commits.`,
    };
  if (range.count === 0)
    return { _tag: "Unavailable", text: "There are no commits to rebase." };
  const commits = await history.ask({ _tag: "Commits", oids: range.moving });
  return { _tag: "Ready", onto, rows: planRows(commits) };
}

export function planRows(
  commits: readonly RepositoryCommit[],
): readonly PlanRow[] {
  const replay = newestFirst(commits)
    .reverse()
    .map(
      (commit): PlanRow => ({
        commit: commit.oid,
        subject: commit.subject,
        action: commit.parents.length > 1 ? "drop" : "pick",
        merge: commit.parents.length > 1,
      }),
    );
  for (const row of [...replay]) {
    const match = /^(fixup|squash)! (.+)$/.exec(row.subject);
    if (match === null) continue;
    const from = replay.indexOf(row);
    const target = replay.findIndex(
      (candidate, index) =>
        index < from &&
        !candidate.merge &&
        !folds(candidate.action) &&
        candidate.subject.startsWith(match[2] ?? ""),
    );
    if (target < 0) continue;
    replay.splice(from, 1);
    let at = target + 1;
    while (at < replay.length && folds(replay[at]?.action)) at += 1;
    replay.splice(at, 0, { ...row, action: match[1] as PlanAction });
  }
  return replay.reverse();
}

export function setAction(
  rows: readonly PlanRow[],
  index: number,
  action: PlanAction,
): readonly PlanRow[] {
  const row = rows[index];
  if (row === undefined || row.merge) return rows;
  return rows.map((candidate, at) =>
    at === index ? { ...candidate, action } : candidate,
  );
}

export function moveRow(
  rows: readonly PlanRow[],
  from: number,
  to: number,
): readonly PlanRow[] {
  const row = rows[from];
  if (row === undefined || row.merge || to < 0 || to >= rows.length)
    return rows;
  const next = rows.filter((_, index) => index !== from);
  next.splice(to, 0, row);
  return next;
}

export function foldTarget(rows: readonly PlanRow[], index: number) {
  for (let at = index + 1; at < rows.length; at += 1) {
    const row = rows[at];
    if (row !== undefined && row.action !== "drop" && !folds(row.action))
      return at;
  }
  return undefined;
}

export function messageOwner(rows: readonly PlanRow[], index: number) {
  const row = rows[index];
  if (row === undefined || row.action === "drop") return undefined;
  const owner = folds(row.action) ? foldTarget(rows, index) : index;
  return owner !== undefined && ownsMessage(rows, owner) ? owner : undefined;
}

export function messageSources(rows: readonly PlanRow[], owner: number) {
  const kept = rows[owner];
  if (kept === undefined) return [];
  return [
    kept.commit,
    ...rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row, index }) =>
          row.action === "squash" && foldTarget(rows, index) === owner,
      )
      .reverse()
      .map(({ row }) => row.commit),
  ];
}

export function planProblem(
  rows: readonly PlanRow[],
  messages: PlanMessages,
): { readonly index: number; readonly text: string } | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row === undefined) continue;
    if (folds(row.action) && foldTarget(rows, index) === undefined)
      return { index, text: `Nothing older to ${row.action} into.` };
    if (ownsMessage(rows, index) && messages[row.commit]?.trim() === "")
      return { index, text: "Message is empty." };
  }
  return undefined;
}

export function planSteps(
  rows: readonly PlanRow[],
  messages: PlanMessages,
): PlanStep[] {
  return rows
    .map((row, index) => ({
      commit: row.commit,
      action: row.action,
      merge: row.merge,
      message: ownsMessage(rows, index)
        ? (messages[row.commit]?.trim() ?? null)
        : null,
    }))
    .filter((step) => !step.merge)
    .map(({ merge: _, ...step }) => step)
    .reverse();
}

export function planCount(rows: readonly PlanRow[]) {
  return rows.filter((row) => row.action !== "drop" && !folds(row.action))
    .length;
}

export function folds(action: PlanAction | undefined) {
  return action === "squash" || action === "fixup";
}

function ownsMessage(rows: readonly PlanRow[], index: number) {
  const row = rows[index];
  if (row === undefined || row.action === "drop" || folds(row.action))
    return false;
  return (
    row.action === "reword" ||
    rows.some(
      (candidate, at) =>
        candidate.action === "squash" && foldTarget(rows, at) === index,
    )
  );
}

function newestFirst(commits: readonly RepositoryCommit[]) {
  const inRange = new Map(commits.map((commit) => [commit.oid, commit]));
  const children = new Map<string, number>();
  for (const commit of commits)
    for (const parent of commit.parents)
      if (inRange.has(parent))
        children.set(parent, (children.get(parent) ?? 0) + 1);
  const ready = commits.filter((commit) => !children.has(commit.oid));
  const ordered: RepositoryCommit[] = [];
  while (ready.length > 0) {
    const commit = ready.shift();
    if (commit === undefined) break;
    ordered.push(commit);
    for (const parent of commit.parents) {
      const left = (children.get(parent) ?? 0) - 1;
      children.set(parent, left);
      const next = inRange.get(parent);
      if (left === 0 && next !== undefined) ready.push(next);
    }
  }
  return ordered;
}
