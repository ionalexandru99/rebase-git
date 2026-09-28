import { Effect } from "effect";
import type { PlanStep } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { operationFailure } from "#server/features/repository-operations/operation-outcome.ts";

export function rebasePlanTodo(
  git: GitCommandRunner,
  directory: string,
  range: string,
  plan: readonly PlanStep[],
) {
  return Effect.gen(function* () {
    const replayed = (yield* runRepositoryGit(git, directory, [
      "rev-list",
      "--no-merges",
      range,
    ]))
      .split("\n")
      .filter(Boolean);
    const planned = new Set(plan.map((step) => step.commit));
    if (
      planned.size !== plan.length ||
      replayed.length !== plan.length ||
      replayed.some((commit) => !planned.has(commit))
    )
      return yield* operationFailure(
        "Stale",
        "The branch changed since the plan was made. Try again.",
      );
    const problem = planProblem(plan);
    if (problem !== undefined)
      return yield* operationFailure("Incompatible", problem);
    const lines: string[] = [];
    let message: string | undefined;
    for (const step of plan) {
      const kept = step.action !== "drop" && !folds(step);
      if (kept && message !== undefined) {
        lines.push(`fixup -C ${message}`);
        message = undefined;
      }
      lines.push(
        `${step.action === "squash" ? "fixup" : step.action} ${step.commit}`,
      );
      if (step.message !== null)
        message = (yield* runRepositoryGit(
          git,
          directory,
          [
            "commit-tree",
            "--no-gpg-sign",
            `${step.commit}^{tree}`,
            "-p",
            step.commit,
          ],
          { input: step.message },
        )).trim();
    }
    if (message !== undefined) lines.push(`fixup -C ${message}`);
    return `${lines.join("\n")}\n`;
  });
}

function planProblem(plan: readonly PlanStep[]) {
  let kept: PlanStep | undefined;
  let squashed = false;
  const unmatched = (head: PlanStep | undefined) =>
    head !== undefined &&
    (head.message !== null) !== (head.action === "reword" || squashed);
  for (const step of plan) {
    if (step.action === "drop") {
      if (step.message !== null) return "A dropped commit has no message.";
      continue;
    }
    if (folds(step)) {
      if (kept === undefined)
        return `${step.commit.slice(0, 8)} has nothing older to fold into.`;
      if (step.message !== null)
        return "A folded commit takes the message of its group.";
      squashed ||= step.action === "squash";
      continue;
    }
    if (unmatched(kept))
      return `${kept?.commit.slice(0, 8)} needs exactly one message.`;
    kept = step;
    squashed = false;
  }
  return unmatched(kept)
    ? `${kept?.commit.slice(0, 8)} needs exactly one message.`
    : undefined;
}

function folds(step: PlanStep) {
  return step.action === "squash" || step.action === "fixup";
}
