import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import type {
  WorktreeFolder,
  WorktreeStart,
} from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import {
  refNameProblem,
  type StartPoint,
} from "#web/features/refs/ref-kinds.ts";
import { listenerBus } from "#web/lib/listener-bus.ts";

export interface WorktreeDraft {
  readonly name: string;
  readonly start: StartPoint | undefined;
}

export type WorktreePlan =
  | { readonly _tag: "Invalid"; readonly message: string | undefined }
  | { readonly _tag: "Switch"; readonly path: string; readonly name: string }
  | { readonly _tag: "Create"; readonly start: WorktreeStart };

export const worktreeDrafts = listenerBus<WorktreeDraft>();

export function worktreeName(path: string) {
  return (
    path
      .split(/[\\/]/)
      .filter((part) => part.length > 0)
      .at(-1) ?? path
  );
}

export function worktreeFolderPath(
  { folder, separator }: WorktreeFolder,
  branch: string,
) {
  const parent = folder.replace(/[\\/]+$/, "");
  return `${parent}${separator}${branch.replace(/[\\/:*?"<>|]/g, "-")}`;
}

export function planWorktree(
  refs: RepositoryRefs,
  name: string,
  start: StartPoint | undefined,
): WorktreePlan {
  const branch = refs.branches.find((candidate) => candidate.name === name);
  const holder =
    branch?.worktreePath === undefined
      ? undefined
      : refs.worktrees.find(({ path }) => path === branch.worktreePath);
  if (holder?.missing === true)
    return {
      _tag: "Invalid",
      message: `Prune ${worktreeName(holder.path)} first.`,
    };
  if (branch?.worktreePath !== undefined)
    return {
      _tag: "Switch",
      path: branch.worktreePath,
      name: worktreeName(branch.worktreePath),
    };
  if (branch !== undefined)
    return { _tag: "Create", start: { _tag: "Branch", name } };
  const message = refNameProblem("branch", name, refs.branches);
  if (message !== undefined || start === undefined)
    return { _tag: "Invalid", message };
  return {
    _tag: "Create",
    start: {
      _tag: "NewBranch",
      name,
      startPoint: start.oid,
      ...(start.track === undefined ? {} : { track: start.track }),
    },
  };
}
