import { Effect } from "effect";
import type { PlanStep } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { operationFailure } from "#server/features/repository-operations/operation-outcome.ts";

const todoCommands: Readonly<Record<PlanStep["action"], string>> = {
  pick: "pick",
  reword: "pick",
  edit: "edit",
  squash: "fixup",
  fixup: "fixup",
  drop: "drop",
};

export function rebasePlanTodo(
  git: GitCommandRunner,
  directory: string,
  range: string,
  plan: readonly PlanStep[],
) {
  return Effect.gen(function* () {
    const replayed = new Map(
      (yield* runRepositoryGit(git, directory, [
        "log",
        "--no-merges",
        "--format=%H%x00%P%x00%an%x00%ae%x00%ad%x00%s",
        "--date=raw",
        range,
      ]))
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [commit = "", parents = "", name, email, date, subject] =
            line.split("\0");
          return [
            commit,
            { parent: parents.split(" ")[0] ?? "", name, email, date, subject },
          ] as const;
        }),
    );
    if (
      new Set(plan.map((step) => step.commit)).size !== plan.length ||
      replayed.size !== plan.length ||
      plan.some((step) => !replayed.has(step.commit))
    )
      return yield* operationFailure(
        "Stale",
        "The branch changed since the plan was made. Try again.",
      );
    const problem = planProblem(plan);
    if (problem !== undefined)
      return yield* operationFailure("Incompatible", problem);
    const signed =
      (yield* runRepositoryGit(
        git,
        directory,
        ["config", "--type=bool", "--get", "commit.gpgSign"],
        { exitCodes: [0, 1] },
      )).trim() === "true";
    const lines: string[] = [];
    for (const step of plan) {
      const original = replayed.get(step.commit);
      const commit =
        step.message === null || original === undefined
          ? step.commit
          : (yield* runRepositoryGit(
              git,
              directory,
              [
                "commit-tree",
                signed ? "-S" : "--no-gpg-sign",
                `${step.commit}^{tree}`,
                ...(original.parent === "" ? [] : ["-p", original.parent]),
              ],
              {
                input: `${step.message}\n`,
                environment: {
                  GIT_AUTHOR_NAME: original.name ?? "",
                  GIT_AUTHOR_EMAIL: original.email ?? "",
                  GIT_AUTHOR_DATE: `@${original.date ?? ""}`,
                },
              },
            )).trim();
      const subject = (step.message ?? original?.subject ?? "").split(
        /\r?\n/,
      )[0];
      lines.push(`${todoCommands[step.action]} ${commit} # ${subject}`);
    }
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
